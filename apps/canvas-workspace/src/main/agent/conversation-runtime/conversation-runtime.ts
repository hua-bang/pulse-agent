import { appendContentText, appendContentTool, contentText, finishContentBlocks } from '../../../shared/chat-content-blocks';
import type {
  AgentChatMessage,
  AgentChatToolCall,
  AgentClarificationRequest,
  AgentRequestContext,
  ChatImageAttachment,
} from '../../../shared/agent-chat';
import type { RoleTurnEndEvent, RoleTurnStartEvent } from '../../../shared/agent-roles';
import {
  CHAT_RECOVERY_REJECTED,
  type ConversationKey,
  type ConversationSendInput,
  type ConversationSnapshot,
} from '../../../shared/conversation-runtime';
import type { CanvasAgentPerformanceTiming } from '../debug-trace';
import { markConversationLaneEntered, observeConversationPersistence } from '../observability/host-run';
import { ClarificationRegistry } from '../run/clarification-registry';
import { TurnToolTracker } from './turn-tools';

/** How often an in-flight reply is saved, so a crash keeps the partial text. */
export const DRAFT_CHECKPOINT_MS = 5_000;

/** Tool-call start emitted by the engine while a turn streams. */
export interface TurnToolCall {
  name: string;
  args?: unknown;
  toolCallId?: string;
}

/** Tool-call result emitted by the engine. */
export interface TurnToolResult {
  name: string;
  result: string;
  toolCallId?: string;
  status?: 'succeeded' | 'failed' | 'cancelled';
  error?: string;
  mcpApp?: AgentChatToolCall['mcpApp'];
}

/**
 * The per-turn engine surface a runtime drives. The runner is injected so this
 * module is testable without a live Engine; phase 2/4 wires it to the shared
 * workspace Engine (`CanvasAgent.chat`). The runner receives the conversation's
 * durable history and an AbortSignal, and streams progress back through
 * callbacks. `onClarificationRequest` may return a promise that resolves with
 * the user's answer — matching the engine's `PendingClarificationRequest` wait.
 */
export interface TurnRunnerContext {
  performanceTiming?: CanvasAgentPerformanceTiming;
  message: string;
  history: AgentChatMessage[];
  signal: AbortSignal;
  /** The conversation session id this turn anchors to (engine read-back). */
  expectedSessionId?: string;
  mentionedWorkspaceIds?: string[];
  requestContext?: AgentRequestContext;
  attachments?: ChatImageAttachment[];
  onText?: (delta: string) => void;
  onToolCall?: (data: TurnToolCall) => void;
  onToolResult?: (data: TurnToolResult) => void;
  onToolInputStart?: (data: { id: string; toolName: string }) => void;
  onToolInputDelta?: (data: { id: string; delta: string }) => void;
  onToolInputEnd?: (data: { id: string }) => void;
  onClarificationRequest?: (req: AgentClarificationRequest) => Promise<string> | void;
  onRoleTurnStart?: (event: RoleTurnStartEvent) => void;
  onRoleTurnEnd?: (event: RoleTurnEndEvent) => void;
}

export interface TurnRunnerResult {
  response: string;
  assistantMessages?: AgentChatMessage[];
  code?: string;
  runId?: string;
  stopped?: boolean;
  error?: string;
  speakerRole?: { id: string; name: string; color: string };
}

export interface ConversationRuntimeDeps {
  key: ConversationKey;
  /** Load the conversation's durable messages on first open. */
  loadMessages: () => Promise<AgentChatMessage[]>;
  /** Persist before executing a user turn and again after it settles. */
  persist: (messages: AgentChatMessage[]) => Promise<void>;
  /** Hold the host mutation lease across a complete turn, including persistence. */
  withTurnLease?: (operation: () => Promise<TurnRunnerResult>) => Promise<TurnRunnerResult>;
  /** Execute one turn against the shared Engine. */
  runTurn: (ctx: TurnRunnerContext) => Promise<TurnRunnerResult>;
  /** Draft checkpoint interval; 0 disables checkpoints. */
  checkpointMs?: number;
}

/**
 * Per-call stream callbacks an external caller (the IPC layer) attaches to a
 * turn. The runtime forwards engine emissions both to its own snapshot state
 * AND to these callbacks so the existing prepare → subscribe → start protocol
 * can be driven through the conversation runtime without losing events.
 */
export interface ConversationTurnExternal {
  performanceTiming?: CanvasAgentPerformanceTiming;
  onText?: (delta: string) => void;
  onToolCall?: (data: TurnToolCall) => void;
  onToolResult?: (data: TurnToolResult) => void;
  onToolInputStart?: (data: { id: string; toolName: string }) => void;
  onToolInputDelta?: (data: { id: string; delta: string }) => void;
  onToolInputEnd?: (data: { id: string }) => void;
  onClarificationRequest?: (req: AgentClarificationRequest) => void;
  onRoleTurnStart?: (event: RoleTurnStartEvent) => void;
  onRoleTurnEnd?: (event: RoleTurnEndEvent) => void;
}

/**
 * The runtime a conversation owns. It holds every piece of *run state*
 * (messages, streaming tools, clarification, queue, abort) and delegates
 * execution to the shared, stateless workspace Engine via {@link deps.runTurn}.
 *
 * Concurrency invariants (all covered by the shared contract test + this
 * module's own test):
 *   - two runtimes in one workspace never share mutable state,
 *   - a second `send` while running is queued, not dropped or interleaved,
 *   - `abort` and `answerClarification` act only on this conversation.
 */
export class ConversationRuntime {
  readonly key: ConversationKey;
  private messages: AgentChatMessage[] = [];
  private status: ConversationSnapshot['status'] = 'idle';
  private tools = new TurnToolTracker();
  /** The active turn's assistant message while it streams; null when idle. */
  private draft: AgentChatMessage | null = null;
  private clarification: AgentClarificationRequest | null = null;
  private error: string | null = null;
  private runId: string | null = null;
  private sequence = 0;
  private listeners = new Set<() => void>();
  private queue: Array<ConversationSendInput & {
    _resolve?: (r: TurnRunnerResult) => void;
    _external?: ConversationTurnExternal;
  }> = [];
  private controller: AbortController | null = null;
  private clarifications = new ClarificationRegistry();
  private disposed = false;
  private loaded = false;

  constructor(private readonly deps: ConversationRuntimeDeps) {
    this.key = deps.key;
  }

  /** Load durable messages once. Idempotent; a no-op after first open. */
  async open(): Promise<void> {
    if (this.loaded || this.disposed) return;
    this.messages = await this.deps.loadMessages();
    this.loaded = true;
  }

  getSnapshot(): ConversationSnapshot {
    return {
      key: this.key,
      status: this.status,
      messages: [...this.messages],
      streamingTools: this.tools.tools.map(tool => ({ ...tool })),
      draft: this.draft ? {
        ...this.draft,
        contentBlocks: this.draft.contentBlocks ? [...this.draft.contentBlocks] : undefined,
      } : null,
      clarification: this.clarification ? { ...this.clarification } : null,
      error: this.error,
      runId: this.runId,
      sequence: this.sequence,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  send(input: ConversationSendInput, external?: ConversationTurnExternal): boolean {
    if (this.disposed) return false;
    if (this.status === 'running') {
      this.queue.push(input);
      this.publish();
      return true;
    }
    void this.startTurn(input, external);
    return true;
  }

  /**
   * Send a turn and await its completion. Used by the IPC-driven service path
   * (prepare → subscribe → start): the runtime owns the queue + run state and
   * still forwards stream events to `external`, so the legacy protocol can run
   * through the registry without losing a single event.
   */
  async sendAndWait(
    input: ConversationSendInput,
    external?: ConversationTurnExternal,
  ): Promise<TurnRunnerResult> {
    if (this.disposed) return { response: '' };
    if (this.status === 'running') {
      // Serialize behind the running turn (same-conversation queue semantics).
      const queued = new Promise<TurnRunnerResult>((resolve) => {
        this.queue.push({ ...input, _resolve: resolve, _external: external });
      });
      this.publish();
      return queued;
    }
    return this.startTurn(input, external);
  }

  abort(): boolean {
    if (this.disposed || this.status !== 'running' || !this.controller) return false;
    this.controller.abort();
    return true;
  }

  answerClarification(requestId: string, answer: string): boolean {
    if (this.disposed) return false;
    const matched = this.clarifications.answer(requestId, answer);
    if (matched) {
      this.syncClarification();
      this.publish();
    }
    return matched;
  }

  /** Deliver the current pending request to a reconnecting renderer. */
  getPendingClarification(): AgentClarificationRequest | null {
    return this.clarifications.latest();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller?.abort();
    this.listeners.clear();
    for (const queued of this.queue.splice(0)) queued._resolve?.({ response: '', stopped: true });
  }

  private async startTurn(
    input: ConversationSendInput,
    external?: ConversationTurnExternal,
  ): Promise<TurnRunnerResult> {
    this.status = 'running';
    this.error = null;
    this.runId = null;
    this.controller = new AbortController();
    try {
      const operation = () => this.executeTurn(input, external);
      return await (this.deps.withTurnLease ? this.deps.withTurnLease(operation) : operation());
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return { response: '', error: this.error };
    } finally {
      this.status = 'idle';
      this.tools.reset();
      this.draft = null;
      this.clarification = null;
      this.controller = null;
      this.runId = null;
      this.publish();
      // The previous lease must be released before the next queued turn starts.
      void this.drain();
    }
  }

  private async executeTurn(
    input: ConversationSendInput,
    external?: ConversationTurnExternal,
  ): Promise<TurnRunnerResult> {
    markConversationLaneEntered(external?.performanceTiming);
    const rejectRecovery = (error: string): TurnRunnerResult => {
      this.error = error;
      return { response: '', code: CHAT_RECOVERY_REJECTED, error };
    };
    let beforeRecovery: AgentChatMessage[] | null = null;
    if (input.truncateAt !== undefined) {
      // Edit/regenerate replace a user turn in place; refuse a stale index
      // rather than cutting unrelated history.
      if (!Number.isInteger(input.truncateAt) || this.messages[input.truncateAt]?.role !== 'user') {
        return rejectRecovery('The message to resend is no longer in this conversation.');
      }
      beforeRecovery = [...this.messages];
      this.messages.length = input.truncateAt;
    }
    this.messages.push({
      role: 'user',
      content: input.message,
      timestamp: Date.now(),
      attachments: input.attachments?.length ? input.attachments : undefined,
      contextSnapshot: input.requestContext?.contextSnapshot,
      mcpAppContext: input.requestContext?.mcpAppContext,
      mcpAppMentions: input.requestContext?.mcpAppMentions,
    });
    this.publish();

    // Materialize the user turn before invoking the model. This makes a new
    // conversation durable/listable as soon as the user sends, so switching
    // away during generation cannot hide the session from the rail.
    try {
      await this.deps.persist([...this.messages]);
    } catch (err) {
      if (!beforeRecovery) throw err;
      // The replacement was never committed: a later send must not persist the cut.
      this.messages = beforeRecovery;
      this.publish();
      return rejectRecovery(err instanceof Error ? err.message : String(err));
    }

    const assistant: AgentChatMessage = { role: 'assistant', content: '', contentBlocks: [], timestamp: Date.now() };
    this.draft = assistant;
    const checkpoints = this.startDraftCheckpoints(assistant);
    const trackTools = () => {
      assistant.contentBlocks = this.tools.tools.reduce(appendContentTool, assistant.contentBlocks!);
    };
    let result: TurnRunnerResult = { response: '' };
    try {
      result = await this.deps.runTurn({
        performanceTiming: external?.performanceTiming,
        message: input.message,
        history: this.messages.slice(0, -1),
        signal: this.controller!.signal,
        expectedSessionId: this.key.sessionId,
        mentionedWorkspaceIds: input.mentionedWorkspaceIds,
        requestContext: input.requestContext,
        attachments: input.attachments,
        onText: (delta) => {
          assistant.content += delta;
          assistant.contentBlocks = appendContentText(assistant.contentBlocks!, delta);
          external?.onText?.(delta);
          this.publish();
        },
        onToolCall: (data) => {
          this.tools.call(data);
          trackTools();
          external?.onToolCall?.(data);
          this.publish();
        },
        onToolResult: (data) => {
          this.tools.result(data);
          external?.onToolResult?.(data);
          this.publish();
        },
        onToolInputStart: (data) => {
          this.tools.inputStart(data);
          trackTools();
          external?.onToolInputStart?.(data);
          this.publish();
        },
        onToolInputDelta: (data) => {
          this.tools.inputDelta(data);
          external?.onToolInputDelta?.(data);
          this.publish();
        },
        onToolInputEnd: (data) => {
          this.tools.inputEnd(data);
          external?.onToolInputEnd?.(data);
          this.publish();
        },
        onClarificationRequest: (req) => {
          return this.clarifications.wait(
            req,
            (request) => {
              this.clarification = { ...request };
              this.publish();
              external?.onClarificationRequest?.(request);
            },
            this.controller?.signal,
          );
        },
        onRoleTurnStart: external?.onRoleTurnStart,
        onRoleTurnEnd: external?.onRoleTurnEnd,
      });
      assistant.contentBlocks = finishContentBlocks(assistant.contentBlocks!, result.response);
      assistant.content = contentText(assistant.contentBlocks);
      assistant.runId = result.runId;
      assistant.speakerRoleId = result.speakerRole?.id;
      assistant.speakerRoleName = result.speakerRole?.name;
      assistant.speakerRoleColor = result.speakerRole?.color;
      this.runId = result.runId ?? null;
      if (result.stopped) assistant.turnStatus = 'stopped';
      if (result.error) {
        this.error = result.error;
        if (!result.stopped) assistant.turnStatus = 'failed';
      }
    } catch (err) {
      assistant.turnStatus = 'failed';
      this.error = err instanceof Error ? err.message : String(err);
      result = { response: '', error: this.error };
    }

    // No checkpoint may land after the final write below.
    const checkpointWrite = checkpoints.stop();
    if (checkpointWrite) await checkpointWrite;
    this.draft = null;
    assistant.toolCalls = this.tools.settled(assistant.turnStatus === 'stopped');
    if (result.assistantMessages?.length) {
      this.messages.push(...result.assistantMessages);
    } else if (assistant.content.length > 0 || assistant.toolCalls?.length || assistant.turnStatus) {
      this.messages.push(assistant);
    }
    try {
      await observeConversationPersistence(external?.performanceTiming, () => this.deps.persist([...this.messages]));
    } catch (err) {
      this.error = this.error ?? (err instanceof Error ? err.message : String(err));
      result = { ...result, error: this.error };
    }

    return result;
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.status === 'running') return;
    const next = this.queue.shift();
    if (!next) return;
    const result = await this.startTurn(next, next._external);
    next._resolve?.(result);
  }

  /**
   * Periodically save the streaming reply as an interrupted turn. A normal
   * finish replaces it; after a crash the partial reply and its retry remain.
   */
  private startDraftCheckpoints(assistant: AgentChatMessage): { stop: () => Promise<void> | null } {
    const interval = this.deps.checkpointMs ?? DRAFT_CHECKPOINT_MS;
    if (interval <= 0) return { stop: () => null };
    let pending: Promise<void> | null = null;
    let savedSignature = '';
    const timer = setInterval(() => {
      const toolCalls = this.tools.settled(true);
      const signature = `${assistant.content.length}:${JSON.stringify(toolCalls?.map(tool => tool.status) ?? [])}`;
      if (signature === savedSignature || (!assistant.content && !toolCalls)) return;
      savedSignature = signature;
      const draft: AgentChatMessage = {
        ...assistant,
        contentBlocks: assistant.contentBlocks ? [...assistant.contentBlocks] : undefined,
        toolCalls,
        turnStatus: 'failed',
        failureKind: 'interrupted',
        retryable: true,
      };
      const messages = [...this.messages, draft];
      const write: Promise<void> = (pending ?? Promise.resolve())
        .then(() => this.deps.persist(messages))
        .catch((err) => { console.warn('[conversation-runtime] draft checkpoint failed', err); })
        .finally(() => { if (pending === write) pending = null; });
      pending = write;
    }, interval);
    return {
      stop: () => {
        clearInterval(timer);
        return pending;
      },
    };
  }

  /** Reflect the ClarificationRegistry's queue head into the snapshot. */
  private syncClarification(): void {
    const latest = this.clarifications.latest();
    this.clarification = latest ? { ...latest } : null;
  }

  private publish(): void {
    this.sequence += 1;
    for (const listener of [...this.listeners]) listener();
  }
}
