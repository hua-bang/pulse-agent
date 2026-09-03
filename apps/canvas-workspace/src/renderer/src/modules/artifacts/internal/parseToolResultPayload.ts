/** Parse a direct Engine result or Pi's persisted text-content envelope. */
export function parseToolResultPayload<T>(raw?: string): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return parsed as T;
    const text = parsed
      .filter((part): part is { type: 'text'; text: string } => (
        !!part
        && typeof part === 'object'
        && (part as { type?: unknown }).type === 'text'
        && typeof (part as { text?: unknown }).text === 'string'
      ))
      .map(part => part.text)
      .join('');
    return text ? JSON.parse(text) as T : null;
  } catch {
    return null;
  }
}
