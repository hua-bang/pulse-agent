/**
 * Conversation runtime contract.
 *
 * A conversation is the unit that owns all *run state*: messages, progress,
 * control signals (abort/clarification), and subscriptions. A workspace owns
 * the shared resources an Engine needs (tools, MCP clients, config, plan-mode)
 * and hands them into each turn. Splitting these two layers is what makes two
 * conversations in one workspace genuinely concurrent: they never share the
 * mutable run state, only the stateless executor + shared resources.
 *
 * This module is the type-level + invariant-level contract. It is pure
 * (no Electron/React/Engine imports) so it can be tested in isolation and
 * reused by both the main-process registry (phase 2) and the renderer store
 * (phase 3).
 */

import type {
  AgentChatMessage,
  AgentChatToolCall,
  AgentClarificationRequest,
  AgentRequestContext,
  AgentScope,
  ChatImageAttachment,
} from './agent-chat';
import { scopeSessionStoreId } from './agent-chat';

/** Uniquely identifies one conversation. `storeId` is a session-store id. */
export interface ConversationKey {
  storeId: string;
  sessionId: string;
}

/** Build a key from a scope + session id, reusing the single scope→store mapping. */
export const conversationKey = (scope: AgentScope, sessionId: string): ConversationKey => ({
  storeId: scopeSessionStoreId(scope),
  sessionId,
});

/** Stable string form of a key (map/dictionary keys, logging, tests). */
export const conversationKeyId = (key: ConversationKey): string =>
  `${key.storeId}\u0000${key.sessionId}`;

export type ConversationStatus = 'idle' | 'running';

/**
 * Immutable read-model handed to subscribers. `messages` and `streamingTools`
 * are always fresh arrays so a held reference never mutates under a reader.
 * `sequence` increments monotonically on every published change.
 */
export interface ConversationSnapshot {
  key: ConversationKey;
  status: ConversationStatus;
  messages: AgentChatMessage[];
  /** Tool calls currently streaming in the active turn (not yet persisted). */
  streamingTools: AgentChatToolCall[];
  clarification: AgentClarificationRequest | null;
  error: string | null;
  runId: string | null;
  sequence: number;
}

export interface ConversationSendInput {
  message: string;
  mentionedWorkspaceIds?: string[];
  requestContext?: AgentRequestContext;
  attachments?: ChatImageAttachment[];
}

export interface ConversationFinishResult {
  messages?: AgentChatMessage[];
  stopped?: boolean;
  error?: string;
}

/**
 * The consumer-facing runtime surface: a conversation's run state is read
 * through snapshots + subscriptions and driven through send/abort/clarify.
 * Engine-backed implementations may expose extra methods (e.g. `finish` for
 * the in-memory reference, `open` for lazy loading) without widening this
 * contract — consumers depend only on this surface.
 */
export interface ConversationRuntime {
  readonly key: ConversationKey;
  getSnapshot(): ConversationSnapshot;
  subscribe(listener: () => void): () => void;
  /** Accept a turn. Rejected while the conversation already has a running turn. */
  send(input: ConversationSendInput): boolean;
  /** Abort the active turn. No-op (false) when idle. */
  abort(): boolean;
  answerClarification(requestId: string, answer: string): boolean;
  dispose(): void;
}

/**
 * Engine-simulation extension of the in-memory reference implementation.
 * `finish` settles a running turn; `setClarification` injects a pending
 * request. Real engine runtimes drive these internally instead.
 */
export interface EngineDrivenConversationRuntime extends ConversationRuntime {
  finish(result: ConversationFinishResult): void;
  setClarification(request: AgentClarificationRequest): void;
}

let nextRunId = 0;

/**
 * Reference implementation of {@link ConversationRuntime}. Owns only the run
 * state and enforces the concurrency invariants the contract promises. Phase 2
 * wraps the real Engine.run around this state kernel; phase 3 mirrors it in the
 * renderer store. Keeping it in `shared/` lets all three layers test against
 * the same invariants.
 */
export class InMemoryConversationRuntime implements EngineDrivenConversationRuntime {
  readonly key: ConversationKey;
  private messages: AgentChatMessage[];
  private status: ConversationStatus = 'idle';
  private streamingTools: AgentChatToolCall[] = [];
  private clarification: AgentClarificationRequest | null = null;
  private error: string | null = null;
  private runId: string | null = null;
  private sequence = 0;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(key: ConversationKey, initialMessages: AgentChatMessage[] = []) {
    this.key = key;
    this.messages = [...initialMessages];
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

  send(input: ConversationSendInput): boolean {
    if (this.disposed || this.status !== 'idle') return false;
    this.messages.push({ role: 'user', content: input.message, timestamp: Date.now() });
    this.status = 'running';
    this.runId = `run-${++nextRunId}`;
    this.error = null;
    this.publish();
    return true;
  }

  finish(result: ConversationFinishResult): void {
    if (this.disposed) return;
    if (result.messages) this.messages.push(...result.messages);
    if (result.error) this.error = result.error;
    this.status = 'idle';
    this.streamingTools = [];
    this.clarification = null;
    this.runId = null;
    this.publish();
  }

  abort(): boolean {
    if (this.disposed || this.status !== 'running') return false;
    this.status = 'idle';
    this.streamingTools = [];
    this.clarification = null;
    this.runId = null;
    this.publish();
    return true;
  }

  setClarification(request: AgentClarificationRequest): void {
    if (this.disposed) return;
    this.clarification = { ...request };
    this.publish();
  }

  answerClarification(requestId: string, _answer: string): boolean {
    if (this.disposed || this.clarification?.id !== requestId) return false;
    this.clarification = null;
    this.publish();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }

  private publish(): void {
    this.sequence += 1;
    for (const listener of [...this.listeners]) listener();
  }
}
