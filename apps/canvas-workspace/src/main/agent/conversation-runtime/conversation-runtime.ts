import type {
  AgentChatMessage,
  AgentChatToolCall,
  AgentClarificationRequest,
  AgentRequestContext,
  ChatImageAttachment,
} from '../../../shared/agent-chat';
import type { RoleTurnEndEvent, RoleTurnStartEvent } from '../../../shared/agent-roles';
import {
  type ConversationKey,
  type ConversationSendInput,
  type ConversationSnapshot,
} from '../../../shared/conversation-runtime';
import { ClarificationRegistry } from '../clarification-registry';

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
  /** Persist the conversation's full message list after each settled turn. */
  persist: (messages: AgentChatMessage[]) => Promise<void>;
  /** Execute one turn against the shared Engine. */
  runTurn: (ctx: TurnRunnerContext) => Promise<TurnRunnerResult>;
}

/**
 * Per-call stream callbacks an external caller (the IPC layer) attaches to a
 * turn. The runtime forwards engine emissions both to its own snapshot state
 * AND to these callbacks so the existing prepare → subscribe → start protocol
 * can be driven through the conversation runtime without losing events.
 */
export interface ConversationTurnExternal {
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

const findRunningTool = (
  tools: AgentChatToolCall[],
  toolCallId: string | undefined,
  name?: string,
): AgentChatToolCall | undefined => {
  const byId = toolCallId
    ? tools.find(tool => tool.toolCallId === toolCallId && tool.status === 'running')
    : undefined;
  if (byId) return byId;
  if (!name) return undefined;
  return tools.find(tool => tool.name === name && tool.status === 'running');
};

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
  private streamingTools: AgentChatToolCall[] = [];
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
  private toolIdCounter = 0;

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
      streamingTools: [...this.streamingTools],
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
    this.queue.length = 0;
  }

  private async startTurn(
    input: ConversationSendInput,
    external?: ConversationTurnExternal,
  ): Promise<TurnRunnerResult> {
    this.status = 'running';
    this.error = null;
    this.runId = null;
    this.messages.push({
      role: 'user',
      content: input.message,
      timestamp: Date.now(),
      attachments: input.attachments?.length ? input.attachments : undefined,
      contextSnapshot: input.requestContext?.contextSnapshot,
    });
    this.controller = new AbortController();
    this.publish();

    // Materialize the user turn before invoking the model. This makes a new
    // conversation durable/listable as soon as the user sends, so switching
    // away during generation cannot hide the session from the rail.
    const userMessagePersist = this.deps.persist([...this.messages]).catch(() => undefined);

    const assistant: AgentChatMessage = { role: 'assistant', content: '', timestamp: Date.now() };
    let result: TurnRunnerResult = { response: '' };
    try {
      result = await this.deps.runTurn({
        message: input.message,
        history: this.messages.slice(0, -1),
        signal: this.controller.signal,
        expectedSessionId: this.key.sessionId,
        mentionedWorkspaceIds: input.mentionedWorkspaceIds,
        requestContext: input.requestContext,
        attachments: input.attachments,
        onText: (delta) => {
          assistant.content += delta;
          external?.onText?.(delta);
          this.publish();
        },
        onToolCall: (data) => {
          this.upsertTool(data);
          external?.onToolCall?.(data);
          this.publish();
        },
        onToolResult: (data) => {
          this.markToolResult(data);
          external?.onToolResult?.(data);
          this.publish();
        },
        onToolInputStart: (data) => {
          const existing = data.id
            ? this.streamingTools.find(tool => tool.toolCallId === data.id)
            : undefined;
          if (existing) {
            existing.name = data.toolName;
            if (existing.status === 'running') existing.inputStreaming = true;
          } else {
            this.streamingTools.push({
              id: ++this.toolIdCounter,
              name: data.toolName,
              toolCallId: data.id,
              status: 'running',
              partialInput: '',
              inputStreaming: true,
            });
          }
          external?.onToolInputStart?.(data);
          this.publish();
        },
        onToolInputDelta: (data) => {
          const tool = findRunningTool(this.streamingTools, data.id);
          if (tool) tool.partialInput = (tool.partialInput ?? '') + data.delta;
          external?.onToolInputDelta?.(data);
          this.publish();
        },
        onToolInputEnd: (data) => {
          const tool = findRunningTool(this.streamingTools, data.id);
          if (tool) tool.inputStreaming = false;
          external?.onToolInputEnd?.(data);
          this.publish();
        },
        onClarificationRequest: (req) => {
          external?.onClarificationRequest?.(req);
          return this.clarifications.wait(
            req,
            (request) => {
              this.clarification = { ...request };
              this.publish();
            },
            this.controller?.signal,
          );
        },
        onRoleTurnStart: external?.onRoleTurnStart,
        onRoleTurnEnd: external?.onRoleTurnEnd,
      });
      assistant.content = result.response;
      assistant.toolCalls = this.streamingTools.length ? [...this.streamingTools] : undefined;
      assistant.runId = result.runId;
      assistant.speakerRoleId = result.speakerRole?.id;
      assistant.speakerRoleName = result.speakerRole?.name;
      assistant.speakerRoleColor = result.speakerRole?.color;
      this.runId = result.runId ?? null;
      if (result.stopped) assistant.turnStatus = 'stopped';
    } catch (err) {
      assistant.turnStatus = 'failed';
      this.error = err instanceof Error ? err.message : String(err);
      result = { response: '', error: this.error };
    }

    if (assistant.content.length > 0 || assistant.toolCalls?.length || assistant.turnStatus) {
      this.messages.push(assistant);
    }
    await userMessagePersist;
    try {
      await this.deps.persist([...this.messages]);
    } catch (err) {
      this.error = this.error ?? (err instanceof Error ? err.message : String(err));
      result = { ...result, error: this.error };
    }

    this.status = 'idle';
    this.streamingTools = [];
    this.clarification = null;
    this.controller = null;
    this.runId = null;
    this.publish();

    this.drain();
    return result;
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.status === 'running') return;
    const next = this.queue.shift();
    if (!next) return;
    const result = await this.startTurn(next, next._external);
    next._resolve?.(result);
  }

  private upsertTool(data: TurnToolCall): void {
    const existing = data.toolCallId
      ? this.streamingTools.find(tool => tool.toolCallId === data.toolCallId)
      : undefined;
    if (existing) {
      existing.args = data.args;
      existing.inputStreaming = false;
      return;
    }
    this.streamingTools.push({
      id: ++this.toolIdCounter,
      name: data.name,
      args: data.args,
      toolCallId: data.toolCallId,
      status: 'running',
    });
  }

  private markToolResult(data: TurnToolResult): void {
    const tool = findRunningTool(this.streamingTools, data.toolCallId, data.name)
      ?? this.streamingTools.find(t => t.toolCallId === data.toolCallId)
      ?? this.streamingTools.find(t => t.name === data.name);
    if (!tool) return;
    tool.status = data.status ?? 'succeeded';
    tool.result = data.result;
    tool.error = data.error;
    tool.mcpApp = data.mcpApp;
    tool.inputStreaming = false;
    if (tool.streamedContent != null) tool.streamedDone = true;
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
