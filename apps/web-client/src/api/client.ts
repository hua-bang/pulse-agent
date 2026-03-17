const BASE = '/api';

export interface ChatResponse {
  ok: boolean;
  streamId: string;
}

export interface StreamCallbacks {
  onText: (delta: string) => void;
  onToolCall: (toolName: string) => void;
  onClarification: (id: string, prompt: string) => void;
  onDone: (result: string) => void;
  onError: (message: string) => void;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

export async function postChat(
  apiKey: string,
  userId: string,
  message: string,
  forceNew?: boolean,
): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ userId, message, forceNew }),
  });

  if (res.status === 401) throw new Error('AUTH_FAILED');
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);

  return res.json() as Promise<ChatResponse>;
}

/**
 * Open an SSE stream for a given streamId.
 * Returns a cleanup function to close the EventSource.
 *
 * Note: EventSource does not support custom headers.
 * Auth is handled at POST /api/chat level; the streamId itself
 * serves as the unforgeable token for the SSE connection.
 */
export function openStream(streamId: string, callbacks: StreamCallbacks): () => void {
  const es = new EventSource(`${BASE}/stream/${streamId}`);

  es.addEventListener('text', (e) => {
    const data = JSON.parse(e.data) as { delta: string };
    callbacks.onText(data.delta);
  });

  es.addEventListener('tool_call', (e) => {
    const data = JSON.parse(e.data) as { toolName: string };
    callbacks.onToolCall(data.toolName);
  });

  es.addEventListener('clarification', (e) => {
    const data = JSON.parse(e.data) as { id: string; prompt: string };
    callbacks.onClarification(data.id, data.prompt);
  });

  es.addEventListener('done', (e) => {
    const data = JSON.parse(e.data) as { result: string };
    callbacks.onDone(data.result);
    es.close();
  });

  es.addEventListener('error', (e) => {
    if (e instanceof MessageEvent) {
      const data = JSON.parse(e.data) as { message: string };
      callbacks.onError(data.message);
    } else {
      callbacks.onError('Stream connection failed');
    }
    es.close();
  });

  return () => es.close();
}

export async function postClarify(
  apiKey: string,
  streamId: string,
  clarificationId: string,
  answer: string,
): Promise<void> {
  await fetch(`${BASE}/clarify/${streamId}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ clarificationId, answer }),
  });
}
