import type { AgentChatResult, AgentScope, CanvasAgentServiceRef } from '../../../types';
import type { PluginStore } from '../../../types';
import { BindingStore } from './binding';
import { buildWorkspacePickerReply, handleCommand } from './commands';
import { MessageDedupe } from './dedupe';
import { extractGeneratedImageResult } from './image-result';
import { SessionRouter } from './sessions';
import type { Channel, ChannelStream, CommandReply, InboundMessage, OutboundTarget } from './types';
import { listWorkspaces, workspaceLabelById } from './workspaces';

interface ActiveRun {
  channelId: string;
  conversationId: string;
  /** Set while the agent is awaiting an answer to a clarification request. */
  pendingClarificationId?: string;
}

const DEFAULT_RUN_IDLE_TIMEOUT_MS = 2 * 60_000;
const RUN_IDLE_TIMEOUT_ENV = 'CANVAS_CHANNEL_RUN_IDLE_TIMEOUT_MS';

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
  private readonly runIdleTimeoutMs: number;

  constructor(
    private readonly service: CanvasAgentServiceRef,
    store: PluginStore,
    options: {
      activateCanvas?: (workspaceId: string) => Promise<{ ok: boolean; error?: string }>;
      runIdleTimeoutMs?: number;
    } = {},
  ) {
    this.bindings = new BindingStore(store);
    this.sessions = new SessionRouter(service, store);
    this.activateCanvas = options.activateCanvas;
    this.runIdleTimeoutMs =
      options.runIdleTimeoutMs ??
      readPositiveIntegerEnv(RUN_IDLE_TIMEOUT_ENV) ??
      DEFAULT_RUN_IDLE_TIMEOUT_MS;
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
      await this.sendReply(channel, target, commandReply);
      return;
    }

    if (!msg.text.trim()) return;

    const boundWorkspaceId = await this.bindings.getBound(msg.channelId, msg.conversationId);
    if (!boundWorkspaceId && !msg.isDirect) {
      const currentWorkspaceId = await this.bindCurrentWorkspaceForGroupFirstContact(msg);
      const pickerReply = await buildWorkspacePickerReply(msg, {
        bindings: this.bindings,
        service: this.service,
        sessionRouter: this.sessions,
        activateCanvas: this.activateCanvas,
      }, {
        defaultCarry: true,
        summary: currentWorkspaceId
          ? `Current chat: using ${await workspaceLabelById(currentWorkspaceId)}.`
          : undefined,
      });

      if (!currentWorkspaceId) {
        await this.sendReply(channel, target, pickerReply);
        return;
      }

      await this.runTurn(channel, msg, { kind: 'workspace', workspaceId: currentWorkspaceId });
      await this.sendReply(channel, target, pickerReply);
      return;
    }

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

  private async bindCurrentWorkspaceForGroupFirstContact(
    msg: InboundMessage,
  ): Promise<string | null> {
    const workspaces = await listWorkspaces();
    const current = workspaces.find((w) => w.isActive) ?? (workspaces.length === 1 ? workspaces[0] : null);
    if (!current) return null;

    await this.bindings.bind(msg.channelId, msg.conversationId, current.id);
    return current.id;
  }

  private async sendReply(
    channel: Channel,
    target: OutboundTarget,
    reply: CommandReply,
  ): Promise<void> {
    if (reply.kind === 'workspace_picker' && channel.sendWorkspacePicker) {
      await channel.sendWorkspacePicker(target, reply.picker);
      return;
    }
    await channel.sendText(target, reply.kind === 'workspace_picker' ? reply.picker.fallbackText : reply.text);
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
    let finished = false;
    let idleTimer: NodeJS.Timeout | null = null;
    let lastAgentActivityAt = Date.now();

    const markAgentActivity = (): void => {
      lastAgentActivityAt = Date.now();
    };

    const idleTimeout = new Promise<AgentChatResult>((resolve) => {
      const check = (): void => {
        if (finished) return;
        if (run.pendingClarificationId) {
          lastAgentActivityAt = Date.now();
          idleTimer = setTimeout(check, this.runIdleTimeoutMs);
          return;
        }

        const idleMs = Date.now() - lastAgentActivityAt;
        if (idleMs >= this.runIdleTimeoutMs) {
          const message =
            `No agent activity for ${Math.round(this.runIdleTimeoutMs / 1000)}s. ` +
            'Stopped this run so the chat can continue.';
          console.warn(`[channel:${channel.id}] ${message}`);
          this.service.abortScope(scope);
          resolve({ ok: false, error: message });
          return;
        }

        idleTimer = setTimeout(check, this.runIdleTimeoutMs - idleMs);
      };

      idleTimer = setTimeout(check, this.runIdleTimeoutMs);
    });

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
      const chat = this.service.chatWithScope(
        scope,
        msg.text,
        (delta) => {
          if (finished) return;
          markAgentActivity();
          void Promise.resolve(stream.onText(delta)).catch(noop);
        },
        (toolCall) => {
          if (finished) return;
          markAgentActivity();
          void Promise.resolve(stream.onToolCall(toolCall.name, toolCall.args)).catch(noop);
        },
        (toolResult) => {
          if (finished) return;
          markAgentActivity();
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
          if (finished) return;
          markAgentActivity();
          run.pendingClarificationId = req.id;
          void Promise.resolve(stream.onClarification(req.question)).catch(noop);
        },
      );
      chat.catch((err) => {
        if (finished) {
          console.error(`[channel:${channel.id}] late agent failure after channel timeout`, err);
        }
      });
      const result = await Promise.race([chat, idleTimeout]);

      if (result.ok) {
        await stream.onDone(result.response?.trim() || '✅ Done');
      } else {
        await stream.onError(result.error ?? 'Unknown error');
      }
    } catch (err) {
      await stream.onError(err instanceof Error ? err.message : String(err));
    } finally {
      finished = true;
      if (idleTimer) clearTimeout(idleTimer);
      this.activeRuns.delete(runKey);
    }
  }
}

function agentScopeKey(scope: AgentScope): string {
  return scope.kind === 'global' ? 'global' : `workspace:${scope.workspaceId}`;
}

function readPositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function noop(): void {
  /* swallow streaming-callback errors; the run result is the source of truth */
}
