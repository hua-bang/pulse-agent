import type { CanvasAgentServiceRef } from '../../../types';
import type { PluginStore } from '../../../types';
import { BindingStore } from './binding';
import { buildBindPrompt, handleCommand } from './commands';
import { MessageDedupe } from './dedupe';
import { extractGeneratedImageResult } from './image-result';
import { SessionRouter } from './sessions';
import { listWorkspaces, workspaceLabel } from './workspaces';
import type { Channel, ChannelStream, InboundMessage } from './types';

interface ActiveRun {
  channelId: string;
  conversationId: string;
  /** Set while the agent is awaiting an answer to a clarification request. */
  pendingClarificationId?: string;
}

/**
 * Channel-agnostic orchestration. Receives normalized inbound messages from
 * any number of channels, resolves the target workspace, and drives the
 * Canvas Agent — streaming its output back through the originating channel.
 *
 * Concurrency: at most one in-flight run per workspace. A follow-up message
 * for a busy workspace either answers a pending clarification or is rejected
 * with a "still working" notice.
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

    // Binding is required and sticky, so a chat never silently picks or switches
    // workspaces. To keep that one-time step light, an unbound chat gets a
    // numbered picker (reply with a digit to bind), and binds automatically when
    // there's only one workspace. resolveUnbound returns the workspace to run,
    // or null when it has already replied (picker / bind confirmation).
    let workspaceId = await this.bindings.getBound(msg.channelId, msg.conversationId);
    if (!workspaceId) {
      const resolved = await this.resolveUnbound(channel, msg, target);
      if (!resolved) return;
      workspaceId = resolved;
    }

    // Busy workspace: if THIS conversation is the one awaiting a clarification
    // answer, route the message as the answer. Otherwise (a different
    // conversation bound to the same workspace, or no pending question) tell
    // the user to wait — so a clarification can't be answered by an unrelated
    // chat that happens to share the workspace.
    const existing = this.activeRuns.get(workspaceId);
    if (existing) {
      if (
        existing.pendingClarificationId &&
        existing.conversationId === msg.conversationId
      ) {
        const matched = this.service.answerClarification(
          workspaceId,
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

    await this.runTurn(channel, msg, workspaceId);
  }

  /**
   * Bind an unbound conversation with as little friction as possible, then
   * return the workspace its current message should run in — or null when the
   * turn was consumed by binding (a picker was shown, or the message was just
   * a number selecting one).
   *
   * - A bare number replies to the picker: bind that workspace and stop (the
   *   number isn't a request to run).
   * - Exactly one workspace: bind it and run this message — no picker needed.
   * - Otherwise: show the numbered picker and stop.
   */
  private async resolveUnbound(
    channel: Channel,
    msg: InboundMessage,
    target: { conversationId: string; reply: InboundMessage['reply'] },
  ): Promise<string | null> {
    const workspaces = await listWorkspaces();

    const pick = msg.text.trim().match(/^#?(\d{1,3})$/);
    if (pick) {
      const choice = workspaces[Number(pick[1]) - 1];
      if (!choice) {
        await channel.sendText(target, `No workspace #${pick[1]}.\n${await buildBindPrompt()}`);
        return null;
      }
      await this.bindings.bind(msg.channelId, msg.conversationId, choice.id);
      await channel.sendText(target, `✅ Bound to ${workspaceLabel(choice)}. Send your request.`);
      return null;
    }

    if (workspaces.length === 1) {
      const only = workspaces[0];
      await this.bindings.bind(msg.channelId, msg.conversationId, only.id);
      await channel.sendText(target, `📌 Bound this chat to ${workspaceLabel(only)}.`);
      return only.id;
    }

    await channel.sendText(target, await buildBindPrompt());
    return null;
  }

  private async runTurn(
    channel: Channel,
    msg: InboundMessage,
    workspaceId: string,
  ): Promise<void> {
    const target = { conversationId: msg.conversationId, reply: msg.reply };
    const run: ActiveRun = { channelId: msg.channelId, conversationId: msg.conversationId };
    this.activeRuns.set(workspaceId, run);

    // Give this conversation its own session so topics / chats sharing a
    // workspace keep separate histories. Safe here: runs are serialized per
    // workspace, so nothing else can swap the session mid-turn.
    try {
      await this.sessions.ensureSession(workspaceId, msg.conversationId);
    } catch (err) {
      console.error(`[channel:${channel.id}] failed to select session`, err);
    }

    let stream: ChannelStream;
    try {
      stream = await channel.openStream(target);
    } catch (err) {
      this.activeRuns.delete(workspaceId);
      console.error(`[channel:${channel.id}] failed to open stream`, err);
      return;
    }

    try {
      const result = await this.service.chat(
        workspaceId,
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
      this.activeRuns.delete(workspaceId);
    }
  }
}

function noop(): void {
  /* swallow streaming-callback errors; the run result is the source of truth */
}
