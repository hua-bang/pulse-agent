function readStringField(payload: unknown, keys: string[]): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const source = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function extractSessionId(payload: unknown): string | null {
  const top = readStringField(payload, ['sessionId', 'session_id', 'id']);
  if (top) {
    return top;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const nestedData = (payload as Record<string, unknown>).data;
  const nested = readStringField(nestedData, ['sessionId', 'session_id', 'id']);
  return nested ?? null;
}

export function extractText(payload: unknown): string {
  const top = readStringField(payload, ['text', 'output', 'result', 'answer', 'message']);
  if (top) {
    return top;
  }

  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const nestedData = (payload as Record<string, unknown>).data;
  return readStringField(nestedData, ['text', 'output', 'result', 'answer', 'message']) ?? '';
}

export function extractFinishReason(payload: unknown): string | undefined {
  const top = readStringField(payload, ['finishReason', 'finish_reason']);
  if (top) {
    return top;
  }

  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const nestedData = (payload as Record<string, unknown>).data;
  return readStringField(nestedData, ['finishReason', 'finish_reason']);
}

export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}
