import { useSyncExternalStore } from 'react';
import type {
  AgentChatMessage,
  AgentChatToolCall,
  AgentClarificationRequest,
} from '../../../types';
import type {
  ConversationKey,
  ConversationSnapshot,
} from '../../../../../shared/conversation-runtime';

/** Renderer-side per-conversation live state, keyed by ConversationKey. */
interface RendererConversationState {
  messages: AgentChatMessage[];
  streamingTools: AgentChatToolCall[];
  clarification: AgentClarificationRequest | null;
  error: string | null;
  runId: string | null;
  loading: boolean;
}

const noKey: ConversationKey = { storeId: '', sessionId: '' };
const initialEmpty: RendererConversationState = {
  messages: [],
  streamingTools: [],
  clarification: null,
  error: null,
  runId: null,
  loading: false,
};

/** Module-level store so both ChatPanel and ChatPage share the same runtime state. */
const states = new Map<string, RendererConversationState>();
const listeners = new Map<string, Set<() => void>>();
let nextSequence = 0;
const sequences = new Map<string, number>();
/** Cached snapshot per key so useSyncExternalStore's getSnapshot is referentially stable. */
const snapshots = new Map<string, ConversationSnapshot>();

const keyId = (key: ConversationKey): string => `${key.storeId}\u0000${key.sessionId}`;

function getState(key: ConversationKey): RendererConversationState {
  const id = keyId(key);
  let state = states.get(id);
  if (!state) {
    state = { ...initialEmpty };
    states.set(id, state);
  }
  return state;
}

function publish(key: ConversationKey): void {
  const id = keyId(key);
  nextSequence += 1;
  sequences.set(id, nextSequence);
  // Invalidate the cached snapshot so the next read builds a fresh reference.
  snapshots.delete(id);
  for (const listener of listeners.get(id) ?? []) listener();
}

/** Register a listener for a conversation's snapshot changes. */
export function subscribeConversation(
  key: ConversationKey,
  listener: () => void,
): () => void {
  const id = keyId(key);
  const set = listeners.get(id) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(id, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
}

/** Read the latest snapshot for a conversation (useSyncExternalStore getSnapshot). */
export function readConversationSnapshot(key: ConversationKey): ConversationSnapshot {
  const id = keyId(key);
  const cached = snapshots.get(id);
  if (cached) return cached;
  const state = getState(key);
  const snapshot: ConversationSnapshot = {
    key,
    status: state.loading ? 'running' : 'idle',
    messages: [...state.messages],
    streamingTools: [...state.streamingTools],
    clarification: state.clarification ? { ...state.clarification } : null,
    error: state.error,
    runId: state.runId,
    sequence: sequences.get(id) ?? 0,
  };
  snapshots.set(id, snapshot);
  return snapshot;
}

/** Freeze per-conversation revisions before an async store-level history read. */
export function captureConversationSequences(storeId: string): ReadonlyMap<string, number> {
  const prefix = `${storeId}\u0000`;
  const captured = new Map<string, number>();
  for (const id of states.keys()) {
    if (id.startsWith(prefix)) captured.set(id.slice(prefix.length), sequences.get(id) ?? 0);
  }
  return captured;
}

const EMPTY_SNAPSHOT: ConversationSnapshot = {
  key: { storeId: '', sessionId: '' },
  status: 'idle',
  messages: [],
  streamingTools: [],
  clarification: null,
  error: null,
  runId: null,
  sequence: 0,
};

/** React hook: subscribe to one conversation, switching is just a different key. */
export function useConversationSnapshot(key: ConversationKey): ConversationSnapshot {
  // Empty key = legacy (non-keyed) mode: never touch the store, so legacy
  // surfaces stay exactly as before (no subscription, no re-render churn).
  const active = key.storeId !== '' || key.sessionId !== '';
  return useSyncExternalStore(
    (listener) => (active ? subscribeConversation(key, listener) : () => {}),
    () => (active ? readConversationSnapshot(key) : EMPTY_SNAPSHOT),
    () => (active ? readConversationSnapshot(key) : EMPTY_SNAPSHOT),
  );
}

// ── Mutation API (called by useChatStream / main-stream adapters) ──

export function setConversationMessages(
  key: ConversationKey,
  messages: AgentChatMessage[],
): void {
  const state = getState(key);
  state.messages = [...messages];
  publish(key);
}

/** Persisted history must never replace a newer in-memory running snapshot. */
export function hydrateConversationMessages(
  key: ConversationKey,
  messages: AgentChatMessage[],
  expectedSequence?: number,
): boolean {
  const state = getState(key);
  if (state.loading) return false;
  if (expectedSequence !== undefined && (sequences.get(keyId(key)) ?? 0) !== expectedSequence) {
    return false;
  }
  state.messages = [...messages];
  publish(key);
  return true;
}

export function pushConversationMessage(key: ConversationKey, message: AgentChatMessage): void {
  const state = getState(key);
  state.messages = [...state.messages, message];
  publish(key);
}

export function appendConversationText(key: ConversationKey, delta: string): void {
  const state = getState(key);
  const messages = [...state.messages];
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant') {
    messages[messages.length - 1] = { ...last, content: last.content + delta };
  } else {
    messages.push({ role: 'assistant', content: delta, timestamp: Date.now() });
  }
  state.messages = messages;
  publish(key);
}

/** Append to one turn-owned assistant slot instead of guessing from the tail. */
export function appendConversationTextAt(
  key: ConversationKey,
  messageIndex: number,
  delta: string,
): boolean {
  const state = getState(key);
  const messages = [...state.messages];
  const target = messages[messageIndex];
  if (target?.role !== 'assistant') return false;
  messages[messageIndex] = { ...target, content: target.content + delta };
  state.messages = messages;
  publish(key);
  return true;
}

export function setConversationLoading(key: ConversationKey, loading: boolean): void {
  const state = getState(key);
  if (state.loading === loading) return;
  state.loading = loading;
  publish(key);
}

export function setConversationClarification(
  key: ConversationKey,
  clarification: AgentClarificationRequest | null,
): void {
  const state = getState(key);
  state.clarification = clarification ? { ...clarification } : null;
  publish(key);
}

export function setConversationError(key: ConversationKey, error: string | null): void {
  const state = getState(key);
  state.error = error;
  publish(key);
}

export function setConversationRunId(key: ConversationKey, runId: string | null): void {
  const state = getState(key);
  state.runId = runId;
  publish(key);
}

export function setConversationStreamingTools(
  key: ConversationKey,
  tools: AgentChatToolCall[],
): void {
  const state = getState(key);
  state.streamingTools = [...tools];
  publish(key);
}

export function resetConversation(key: ConversationKey): void {
  const id = keyId(key);
  states.set(id, { ...initialEmpty });
  publish(key);
}

/** Test helper: clear all module state between tests. */
export function resetConversationStoreForTests(): void {
  states.clear();
  listeners.clear();
  sequences.clear();
  snapshots.clear();
  nextSequence = 0;
}
