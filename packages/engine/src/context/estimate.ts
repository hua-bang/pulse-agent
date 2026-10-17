import type { ModelMessage } from 'ai';

/**
 * Flat per-attachment cost. Providers bill images/files by dimensions or
 * pages, not by base64 length, so counting the encoded payload as text
 * overestimates by orders of magnitude.
 */
const MEDIA_PART_TOKENS = 1600;

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
};

/**
 * ASCII runs average about four characters per token; CJK and other
 * non-ASCII text is close to one token per character. Counting both at four
 * characters per token underestimated Chinese history by roughly 3-4x.
 */
export function estimateTextTokens(text: string): number {
  let ascii = 0;
  let wide = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) < 0x80) ascii++;
    else wide++;
  }
  return Math.ceil(ascii / 4 + wide);
}

function estimateToolOutputTokens(output: unknown): number {
  if (!output || typeof output !== 'object') return estimateTextTokens(safeStringify(output));
  const typed = output as { type?: string; value?: unknown };
  if ((typed.type === 'text' || typed.type === 'error-text') && typeof typed.value === 'string') {
    return estimateTextTokens(typed.value);
  }
  if (typed.type === 'content' && Array.isArray(typed.value)) {
    return typed.value.reduce<number>((sum, item) => sum + estimatePartTokens(item), 0);
  }
  return estimateTextTokens(safeStringify(typed.value ?? output));
}

function estimatePartTokens(part: unknown): number {
  if (!part || typeof part !== 'object') return estimateTextTokens(safeStringify(part));
  const typed = part as Record<string, unknown>;
  switch (typed.type) {
    case 'text':
    case 'reasoning':
      return estimateTextTokens(String(typed.text ?? ''));
    case 'image':
    case 'file':
    case 'media':
    case 'image-data':
    case 'file-data':
    case 'image-url':
    case 'file-url':
      return MEDIA_PART_TOKENS;
    case 'tool-call':
      return estimateTextTokens(`${String(typed.toolName ?? '')}${safeStringify(typed.input)}`);
    case 'tool-result':
      return estimateTextTokens(String(typed.toolName ?? '')) + estimateToolOutputTokens(typed.output);
    default:
      return estimateTextTokens(safeStringify(part));
  }
}

export function estimateMessageTokens(message: ModelMessage): number {
  const content = (message as { content?: unknown }).content;
  const body = typeof content === 'string'
    ? estimateTextTokens(content)
    : Array.isArray(content)
      ? content.reduce<number>((sum, part) => sum + estimatePartTokens(part), 0)
      : estimateTextTokens(safeStringify(content));
  // Role and framing overhead per message.
  return body + 4;
}

export function estimateTokens(messages: ModelMessage[]): number {
  let total = 0;
  for (const message of messages) total += estimateMessageTokens(message);
  return total;
}
