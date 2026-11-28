/**
 * Lets a surface that learns about a running turn from outside the turn
 * stream (a shared VPS chat-room event) ask the conversation's stream hook to
 * attach. Requests per session are throttled: room events arrive several
 * times per second, and attach guards duplicates but still costs an IPC call.
 */
type AttachListener = (sessionId: string) => void;

const ATTACH_REQUEST_INTERVAL_MS = 3_000;
const listeners = new Set<AttachListener>();
const lastRequestAt = new Map<string, number>();

export function requestConversationAttach(sessionId: string, now = Date.now()): void {
  const last = lastRequestAt.get(sessionId);
  if (last !== undefined && now - last < ATTACH_REQUEST_INTERVAL_MS) return;
  lastRequestAt.set(sessionId, now);
  for (const listener of [...listeners]) listener(sessionId);
}

export function onConversationAttachRequest(listener: AttachListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
