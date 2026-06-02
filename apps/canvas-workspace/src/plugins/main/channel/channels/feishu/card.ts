// Feishu interactive card (schema 2.0) builders for the streamed agent run.
// One card is created on run start and progressively patched: thinking →
// progress (accumulated text + a live list of tool calls) → done / error.
// On done the tool list folds into a collapsible panel so the answer stays
// front-and-center while the work remains inspectable.

// Feishu rejects oversized card payloads; keep the streamed body bounded.
const MAX_CARD_TEXT = 8000;

function clamp(text: string): string {
  if (text.length <= MAX_CARD_TEXT) return text;
  return `…${text.slice(text.length - MAX_CARD_TEXT)}`;
}

/** One tool call in the run's progress list. */
export interface ToolEntry {
  /** "name — detail" (no status icon; the renderer adds it). */
  label: string;
  /** True once the tool has returned a result. */
  done: boolean;
  /** Wall-clock duration in seconds, set when done. */
  elapsedSec?: number;
}

function md(content: string): object {
  return { tag: 'markdown', content };
}

function card(elements: object[], forward: boolean): object {
  return {
    schema: '2.0',
    config: { enable_forward: forward },
    body: { elements },
  };
}

/** Render the tool calls as a status list (⏳ running · ✅ done with timing). */
function toolLines(tools: ToolEntry[]): string {
  return tools
    .map((t) => {
      const icon = t.done ? '✅' : '⏳';
      const timing = t.done && typeof t.elapsedSec === 'number' ? ` · ${t.elapsedSec}s` : '';
      return `${icon} ${t.label}${timing}`;
    })
    .join('\n');
}

/** A collapsed panel holding the finished tool list (shown on the done card). */
function toolPanel(tools: ToolEntry[]): object {
  const n = tools.length;
  return {
    tag: 'collapsible_panel',
    expanded: false,
    header: {
      title: md(`🛠️ ${n} tool call${n === 1 ? '' : 's'}`),
      vertical_align: 'center',
    },
    elements: [md(toolLines(tools))],
  };
}

export function buildThinkingCard(): object {
  return card([md('Pulse is thinking…')], false);
}

export function buildProgressCard(
  text: string,
  tools: ToolEntry[] = [],
  elapsedSec?: number,
): object {
  const parts: string[] = [];
  if (text.trim()) parts.push(clamp(text.trim()));
  if (tools.length > 0) parts.push(toolLines(tools));
  if (parts.length === 0) parts.push('Pulse is thinking…');
  if (typeof elapsedSec === 'number') parts.push(`---\n⏱️ ${elapsedSec}s`);
  return card([md(parts.join('\n\n'))], false);
}

export function buildDoneCard(text: string, tools: ToolEntry[] = []): object {
  const elements: object[] = [md(clamp(text) || '✅ Done')];
  if (tools.length > 0) elements.push(toolPanel(tools));
  return card(elements, true);
}

export function buildErrorCard(message: string): object {
  return card([md(`❌ Error: ${message}`)], false);
}

/** A short, human-readable label for a tool call: "name — detail". */
export function formatToolLabel(name: string, args: unknown): string {
  const detail = summarizeArgs(args);
  return detail ? `${name} — ${detail}` : name;
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
