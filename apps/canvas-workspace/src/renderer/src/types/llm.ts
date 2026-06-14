export interface LlmApi {
  /** One-shot generation; returns full HTML when complete. */
  generateHTML: (prompt: string) => Promise<{ ok: boolean; html?: string; error?: string }>;
  /** Start a streaming generation; returns a requestId to subscribe to deltas. */
  streamHTML: (prompt: string) => Promise<{ ok: boolean; requestId?: string; error?: string }>;
  /** Subscribe to incremental text chunks during streaming generation. Returns unsubscribe fn. */
  onHTMLDelta: (requestId: string, callback: (delta: string) => void) => () => void;
  /** Subscribe to generation completion. Returns unsubscribe fn. */
  onHTMLComplete: (requestId: string, callback: (result: { ok: boolean; html?: string; error?: string }) => void) => () => void;
}
