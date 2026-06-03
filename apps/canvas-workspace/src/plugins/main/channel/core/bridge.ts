import type { AgentScope, CanvasAgentServiceRef } from '../../../types';
import type { PluginStore } from '../../../types';
import { BindingStore } from './binding';
import { handleCommand } from './commands';
import { MessageDedupe } from './dedupe';
import { extractGeneratedImageResult } from './image-result';
import { SessionRouter } from './sessions';
import type { Channel, ChannelStream, InboundMessage } from './types';

interface ActiveRun {
  channelId: string;
  conversationId: string;
  /** Set while the agent is awaiting an answer to a clarification request. */
  pendingClarificationId?: string;
}

/**
 * Channel-agnostic orchestration. Receives normalized inbound messages from
 * any number of channels, resolves the target agent scope, and drives the
 * Canvas Agent — streaming its output back through the originating channel.
 *
 * Concurrency: at most one in-flight run per scope key. A follow-up message
 * for a busy scope either answers a pending clarification or is rejected with
 * a "still working" notice.
 */
export class ChannelBridge {
  private readonly bindings: BindingStore;
  private readonly sessions: SessionRouter;
  private readonly dedupe = new MessageDedupe();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly channels = new Map<string, Channel>();
  private readonly activateCanvas?: (workspaceId: string) => Promise<{ ok: boolean; error?: string }>;

  constructor(
    private readonly service: CanvasAgentServiceRef,
    store: PluginStore,
    options: {
      activateCanvas?: (workspaceId: string) => Promise<{ ok: boolean; error?: string }>;
    } = {},
  ) {
    this.bindings = new BindingStore(store);
    this.sessions = new SessionRouter(service, store);
    this.activateCanvas = options.activateCanvas;
  }

  /** Register and start a channel, wiring its inbound traffic to this bridge. */
  async addChannel(channel: Channel): Promise<void> {
    this.channels.set(channel.id, channel);
    await channel.start((msg) => {
      void this.handleInbound(channel, msg).catch((err) => {
        console.error(`[channel:${channel.id}] inbound handling failed`, err);
      });
    });
  }

  /** Stop all channels. */
  async stop(): Promise<void> {
    await Promise.all(
      Array.from(this.channels.values()).map((c) =>
        c.stop().catch((err) => console.error(`[channel:${c.id}] stop failed`, err)),
      ),
    );
    this.channels.clear();
  }

  private async handleInbound(channel: Channel, msg: InboundMessage): Promise<void> {
    if (!this.dedupe.accept(msg.messageId)) return;

    const target = { conversationId: msg.conversationId, reply: msg.reply };

    // Slash commands run regardless of workspace binding / busy state.
    const commandReply = await handleCommand(msg, {
      bindings: this.bindings,
      service: this.service,
      sessionRouter: this.sessions,
      activateCanvas: this.activateCanvas,
    });
    if (commandReply !== null) {
      await channel.sendText(target, commandReply);
      return;
    }

    if (!msg.text.trim()) return;

    const boundWorkspaceId = await this.bindings.getBound(msg.channelId, msg.conversationId);
    const scope: AgentScope = boundWorkspaceId
      ? { kind: 'workspace', workspaceId: boundWorkspaceId }
      : { kind: 'global' };
    const runKey = agentScopeKey(scope);

    // Busy scope: if THIS conversation is the one awaiting a clarification
    // answer, route the message as the answer. Otherwise (a different
    // conversation bound to the same scope, or no pending question) tell
    // the user to wait — so a clarification can't be answered by an unrelated
    // chat that happens to share the scope.
    const existing = this.activeRuns.get(runKey);
    if (existing) {
      if (
        existing.pendingClarificationId &&
        existing.conversationId === msg.conversationId
      ) {
        const matched = this.service.answerClarificationForScope(
          scope,
          existing.pendingClarificationId,
          msg.text,
        );
        existing.pendingClarificationId = undefined;
        if (!matched) {
          await channel.sendText(target, '⚠️ Could not match your reply to the pending question.');
        }
      } else {
        await channel.sendText(target, '⏳ Still working on the previous message. Send /stop to cancel.');
      }
      return;
    }

    await this.runTurn(channel, msg, scope);
  }

  private async runTurn(
    channel: Channel,
    msg: InboundMessage,
    scope: AgentScope,
  ): Promise<void> {
    const target = { conversationId: msg.conversationId, reply: msg.reply };
    const run: ActiveRun = { channelId: msg.channelId, conversationId: msg.conversationId };
    const runKey = agentScopeKey(scope);
    this.activeRuns.set(runKey, run);

    // Give this conversation its own session so topics / chats sharing a
    // scope keep separate histories. Safe here: runs are serialized per
    // scope, so nothing else can swap the session mid-turn.
    try {
      await this.sessions.ensureSession(scope, msg.conversationId);
    } catch (err) {
      console.error(`[channel:${channel.id}] failed to select session`, err);
    }

    let stream: ChannelStream;
    try {
      stream = await channel.openStream(target);
    } catch (err) {
      this.activeRuns.delete(runKey);
      console.error(`[channel:${channel.id}] failed to open stream`, err);
      return;
    }

    try {
      const result = await this.service.chatWithScope(
        scope,
        msg.text,
        (delta) => void Promise.resolve(stream.onText(delta)).catch(noop),
        (toolCall) => void Promise.resolve(stream.onToolCall(toolCall.name, toolCall.args)).catch(noop),
        (toolResult) => {
          const image = extractGeneratedImageResult(toolResult);
          if (image && stream.onImage) {
            void Promise.resolve(stream.onImage(image.outputPath, image.mimeType)).catch(noop);
            return;
          }
          if (stream.onToolResult) {
            void Promise.resolve(
              stream.onToolResult({ name: toolResult.name, result: toolResult.result }),
            ).catch(noop);
          }
        },
        undefined,
        (req) => {
          run.pendingClarificationId = req.id;
          void Promise.resolve(stream.onClarification(req.question)).catch(noop);
        },
      );

      if (result.ok) {
        await stream.onDone(result.response?.trim() || '✅ Done');
      } else {
        await stream.onError(result.error ?? 'Unknown error');
      }
    } catch (err) {
      await stream.onError(err instanceof Error ? err.message : String(err));
    } finally {
      this.activeRuns.delete(runKey);
    }
  }
}

function agentScopeKey(scope: AgentScope): string {
  return scope.kind === 'global' ? 'global' : `workspace:${scope.workspaceId}`;
}

function noop(): void {
  /* swallow streaming-callback errors; the run result is the source of truth */
}
