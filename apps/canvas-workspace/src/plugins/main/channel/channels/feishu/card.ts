// Feishu interactive card (schema 2.0) builders for the streamed agent run.
// One card is created on run start and progressively patched: thinking →
// progress (accumulated text + latest tool hint) → done / error.

// Feishu rejects oversized card payloads; keep the streamed body bounded.
const MAX_CARD_TEXT = 8000;

function clamp(text: string): string {
  if (text.length <= MAX_CARD_TEXT) return text;
  return `…${text.slice(text.length - MAX_CARD_TEXT)}`;
}

function card(content: string, forward: boolean): object {
  return {
    schema: '2.0',
    config: { enable_forward: forward },
    body: { elements: [{ tag: 'markdown', content }] },
  };
}

export function buildThinkingCard(): object {
  return card('Pulse is thinking…', false);
}

export function buildProgressCard(text: string, toolHint?: string, elapsedSec?: number): object {
  const parts: string[] = [];
  if (text.trim()) parts.push(clamp(text.trim()));
  const footer: string[] = [];
  if (toolHint) footer.push(toolHint);
  if (typeof elapsedSec === 'number') footer.push(`⏱️ ${elapsedSec}s`);
  if (footer.length === 0 && !text.trim()) footer.push('Pulse is thinking…');
  if (footer.length > 0) parts.push(`\n---\n${footer.join('  ·  ')}`);
  return card(parts.join('\n'), false);
}

export function buildDoneCard(text: string): object {
  return card(clamp(text) || '✅ Done', true);
}

export function buildErrorCard(message: string): object {
  return card(`❌ Error: ${message}`, false);
}

/** A short, human-readable hint for the latest tool call. */
export function formatToolHint(name: string, args: unknown): string {
  const detail = summarizeArgs(args);
  return detail ? `🛠️ ${name} — ${detail}` : `🛠️ ${name}`;
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const record = args as Record<string, unknown>;
  // Prefer a few common, meaningful fields for a compact hint.
  for (const key of ['title', 'path', 'query', 'command', 'name', 'nodeId']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      const v = value.trim();
      return v.length > 60 ? `${v.slice(0, 60)}…` : v;
    }
  }
  return '';
}
