import type { ModelMessage } from 'ai';
import { estimateTextTokens } from './estimate.js';

const MAX_TEXT_CHARS = 4000;
const MAX_TOOL_INPUT_CHARS = 1000;
const MAX_TOOL_OUTPUT_CHARS = 2000;

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
};

const clip = (text: string, max: number): string => (
  text.length > max ? `${text.slice(0, max)} …[${text.length - max} chars omitted]` : text
);

function renderToolOutput(output: unknown): string {
  if (!output || typeof output !== 'object') return safeStringify(output);
  const typed = output as { type?: string; value?: unknown };
  if ((typed.type === 'text' || typed.type === 'error-text') && typeof typed.value === 'string') return typed.value;
  if (typed.type === 'content' && Array.isArray(typed.value)) {
    return typed.value
      .map((item: any) => (item?.type === 'text' ? String(item.text ?? '') : `[${item?.type ?? 'part'}]`))
      .join('\n');
  }
  return safeStringify(typed.value ?? output);
}

function renderPart(role: string, part: any): string | undefined {
  switch (part?.type) {
    case 'text':
      return `[${role}] ${clip(String(part.text ?? ''), MAX_TEXT_CHARS)}`;
    case 'reasoning':
      return undefined;
    case 'tool-call':
      return `[${role} → ${part.toolName}] ${clip(safeStringify(part.input), MAX_TOOL_INPUT_CHARS)}`;
    case 'tool-result':
      return `[${part.toolName} result] ${clip(renderToolOutput(part.output), MAX_TOOL_OUTPUT_CHARS)}`;
    default:
      return `[${role}] [${part?.type ?? 'part'}]`;
  }
}

/**
 * Render history as plain text for the summarizer. Text cannot carry dangling
 * tool-call/result pairs, and per-part clipping keeps one huge tool output
 * from pushing the summary request itself past the context window.
 */
export function renderTranscript(messages: ModelMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string') {
      lines.push(`[${message.role}] ${clip(content, MAX_TEXT_CHARS)}`);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const line = renderPart(message.role, part);
      if (line) lines.push(line);
    }
  }
  return lines.join('\n');
}

/**
 * Keep the transcript within an estimated token budget, including the omission
 * marker. This is not a model tokenizer guarantee. The head is kept because it
 * carries any earlier compaction summary and the original goal; the tail is
 * kept because it carries the latest progress.
 */
export function fitTranscript(transcript: string, budgetTokens: number): string {
  const budget = Math.max(0, Math.floor(budgetTokens));
  if (estimateTextTokens(transcript) <= budget) return transcript;
  const render = (keepChars: number): string => {
    const headChars = Math.floor(keepChars * 0.25);
    const tailChars = keepChars - headChars;
    const omitted = transcript.length - keepChars;
    return `${transcript.slice(0, headChars)}\n…[${omitted} chars of history omitted]…\n${transcript.slice(transcript.length - tailChars)}`;
  };

  // Measure the actual head/tail, whose density can differ from the middle.
  // Growing retained text cannot reduce this estimate: each added character
  // costs at least as much as a digit removed from the omission count.
  let low = 0;
  let high = transcript.length - 1;
  let fitted = '';
  while (low <= high) {
    const keepChars = Math.floor((low + high) / 2);
    const candidate = render(keepChars);
    if (estimateTextTokens(candidate) <= budget) {
      fitted = candidate;
      low = keepChars + 1;
    } else {
      high = keepChars - 1;
    }
  }
  // An empty string is the only option when even the marker cannot fit.
  return fitted;
}
