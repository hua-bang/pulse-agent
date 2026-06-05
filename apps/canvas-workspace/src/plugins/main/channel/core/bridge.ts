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

// A single tool call (a slow vision read, a page navigation/wait, a long bash
// command) can legitimately block its `execute()` for much longer than the
// idle budget *without* emitting any streaming callback. Killing the whole run
// mid-tool is the wrong move, so an in-flight tool gets this larger budget
// instead of the idle one. It still has a ceiling so a genuinely hung tool
// eventually recovers the scope.
const DEFAULT_TOOL_EXEC_TIMEOUT_MS = 5 * 60_000;
const TOOL_EXEC_TIMEOUT_ENV = 'CANVAS_CHANNEL_TOOL_EXEC_TIMEOUT_MS';

// How long to keep a run alive waiting for the user to answer a clarification
// question. Unlike the idle budget this is bounded — otherwise a question that
// was never delivered (or simply ignored) would pin the scope forever, so no
// other message to it could ever run.
const DEFAULT_CLARIFICATION_TIMEOUT_MS = 10 * 60_000;
const CLARIFICATION_TIMEOUT_ENV = 'CANVAS_CHANNEL_CLARIFICATION_TIMEOUT_MS';

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
  private readonly dedupe: MessageDedupe;
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly channels = new Map<string, Channel>();
  private readonly activateCanvas?: (workspaceId: string) => Promise<{ ok: boolean; error?: string }>;
  private readonly runIdleTimeoutMs: number;
  private readonly toolExecTimeoutMs: number;
  private readonly clarificationTimeoutMs: number;

  constructor(
    private readonly service: CanvasAgentServiceRef,
    store: PluginStore,
    options: {
      activateCanvas?: (workspaceId: string) => Promise<{ ok: boolean; error?: string }>;
      runIdleTimeoutMs?: number;
      toolExecTimeoutMs?: number;
      clarificationTimeoutMs?: number;
    } = {},
  ) {
    this.bindings = new BindingStore(store);
    this.sessions = new SessionRouter(service, store);
    // Persist dedupe so a redelivered event that straddles a restart isn't
    // processed twice.
    this.dedupe = new MessageDedupe(500, { store, storeKey: 'dedupe' });
    this.activateCanvas = options.activateCanvas;
    this.runIdleTimeoutMs =
      options.runIdleTimeoutMs ??
      readPositiveIntegerEnv(RUN_IDLE_TIMEOUT_ENV) ??
      DEFAULT_RUN_IDLE_TIMEOUT_MS;
    this.toolExecTimeoutMs = Math.max(
      this.runIdleTimeoutMs,
      options.toolExecTimeoutMs ??
        readPositiveIntegerEnv(TOOL_EXEC_TIMEOUT_ENV) ??
        DEFAULT_TOOL_EXEC_TIMEOUT_MS,
    );
    this.clarificationTimeoutMs =
      options.clarificationTimeoutMs ??
      readPositiveIntegerEnv(CLARIFICATION_TIMEOUT_ENV) ??
      DEFAULT_CLARIFICATION_TIMEOUT_MS;
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
    await this.dedupe.ensureLoaded();
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
    // A tool's `execute()` blocks without emitting any streaming callback, so
    // we track how many are running (and since when) to grant them the larger
    // tool-exec budget instead of tripping the idle watchdog mid-tool.
    let toolsInFlight = 0;
    let toolWorkStartedAt = 0;
    // When set, the run is parked waiting for the user to answer a question.
    let clarificationStartedAt = 0;
    let settleWatchdog: ((result: AgentChatResult) => void) | null = null;

    const markAgentActivity = (): void => {
      lastAgentActivityAt = Date.now();
    };

    const markToolStart = (): void => {
      if (toolsInFlight === 0) toolWorkStartedAt = Date.now();
      toolsInFlight += 1;
      markAgentActivity();
    };

    const markToolEnd = (): void => {
      if (toolsInFlight > 0) toolsInFlight -= 1;
      markAgentActivity();
    };

    // End the run early with an error, aborting the underlying agent. Used by
    // the watchdog and by the clarification-delivery-failure path.
    const failRun = (message: string): void => {
      if (finished) return;
      console.warn(`[channel:${channel.id}] ${message}`);
      this.service.abortScope(scope);
      settleWatchdog?.({ ok: false, error: message });
    };

    const idleTimeout = new Promise<AgentChatResult>((resolve) => {
      settleWatchdog = resolve;

      const check = (): void => {
        if (finished) return;

        // Parked on a clarification: keep idle fresh (so the run doesn't get
        // idle-killed the instant the answer arrives) but bound the wait so an
        // undelivered/ignored question can't pin the scope forever.
        if (run.pendingClarificationId) {
          lastAgentActivityAt = Date.now();
          const waited = Date.now() - clarificationStartedAt;
          if (waited >= this.clarificationTimeoutMs) {
            failRun(
              `No answer to the question for ${Math.round(this.clarificationTimeoutMs / 1000)}s. ` +
                'Stopped this run so the chat can continue.',
            );
            return;
          }
          idleTimer = setTimeout(
            check,
            Math.min(this.runIdleTimeoutMs, this.clarificationTimeoutMs - waited),
          );
          return;
        }

        // A tool is mid-execution: it's working even though nothing streams.
        // Hold off the idle kill until the (larger) tool-exec budget elapses.
        if (toolsInFlight > 0) {
          const toolMs = Date.now() - toolWorkStartedAt;
          if (toolMs < this.toolExecTimeoutMs) {
            idleTimer = setTimeout(check, this.toolExecTimeoutMs - toolMs);
            return;
          }
          failRun(
            `A tool ran for ${Math.round(this.toolExecTimeoutMs / 1000)}s with no result. ` +
              'Stopped this run so the chat can continue.',
          );
          return;
        }

        const idleMs = Date.now() - lastAgentActivityAt;
        if (idleMs >= this.runIdleTimeoutMs) {
          failRun(
            `No agent activity for ${Math.round(this.runIdleTimeoutMs / 1000)}s. ` +
              'Stopped this run so the chat can continue.',
          );
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
          // Args are complete and `execute()` is about to block — mark the
          // tool in-flight so the idle watchdog doesn't kill it mid-run.
          markToolStart();
          void Promise.resolve(
            stream.onToolCall(toolCall.name, toolCall.args, toolCall.toolCallId),
          ).catch(noop);
        },
        (toolResult) => {
          if (finished) return;
          markToolEnd();
          const image = extractGeneratedImageResult(toolResult);
          if (image && stream.onImage) {
            void Promise.resolve(stream.onImage(image.outputPath, image.mimeType)).catch(noop);
            return;
          }
          if (stream.onToolResult) {
            void Promise.resolve(
              stream.onToolResult({
                name: toolResult.name,
                result: toolResult.result,
                toolCallId: toolResult.toolCallId,
              }),
            ).catch(noop);
          }
        },
        undefined,
        (req) => {
          if (finished) return;
          markAgentActivity();
          run.pendingClarificationId = req.id;
          clarificationStartedAt = Date.now();
          // A question that can't be delivered can never be answered, so fail
          // the run instead of parking it until the clarification timeout.
          void Promise.resolve(stream.onClarification(req.question)).catch((err) => {
            console.error(`[channel:${channel.id}] failed to deliver clarification`, err);
            if (run.pendingClarificationId === req.id) run.pendingClarificationId = undefined;
            failRun(
              "Couldn't deliver the agent's question to the chat, so it can't be answered. " +
                'Stopped this run.',
            );
          });
        },
        undefined,
        undefined,
        (toolInput) => {
          if (finished) return;
          markAgentActivity();
          if (stream.onToolInputStart) {
            void Promise.resolve(stream.onToolInputStart(toolInput)).catch(noop);
          }
        },
        (toolInput) => {
          if (finished) return;
          markAgentActivity();
          if (stream.onToolInputDelta) {
            void Promise.resolve(stream.onToolInputDelta(toolInput)).catch(noop);
          }
        },
        (toolInput) => {
          if (finished) return;
          markAgentActivity();
          if (stream.onToolInputEnd) {
            void Promise.resolve(stream.onToolInputEnd(toolInput)).catch(noop);
          }
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
