import { asRecord, compactText, isListTool, isSearchTool, safeStringify } from './tool-input-format.js';

/** Pure formatting for tool results: one-line summaries, bounded content previews,
 *  output-text extraction and error detection. */

/**
 * One-line result summary appended to the tool label.
 * Text output: single line inlined, multi-line counted with a
 * category-appropriate noun. Structured output without a text field yields
 * no summary — never a JSON dump. Errors inline the first error line.
 */
export function summarizeToolResult(name: string, output: unknown, isError: boolean): string {
  const text = extractOutputText(output);
  if (text === null || !text.trim()) {
    return isError ? 'failed' : '';
  }

  const lines = splitOutputLines(text);
  if (isError || lines.length <= 1) {
    return compactText(lines[0] ?? '', isError ? 80 : 60);
  }

  const normalizedName = name.toLowerCase();
  const noun = isSearchTool(normalizedName) ? 'matches' : isListTool(normalizedName) ? 'items' : 'lines';
  return `${lines.length} ${noun}`;
}

export function formatToolResultPreview(output: unknown, maxLines = 3): string {
  const text = extractOutputText(output) ?? compactText(safeStringify(output), 120);
  if (!text.trim()) {
    return '';
  }

  const lines = splitOutputLines(text);
  const head = lines.slice(0, maxLines).map(line => compactText(line, 120));
  const remaining = lines.length - head.length;
  if (remaining > 0) {
    head.push(`… +${remaining} lines`);
  }
  return head.join('\n');
}

function splitOutputLines(text: string): string[] {
  const lines = text.split('\n').map(line => line.trimEnd());
  while (lines.length > 0 && !lines[lines.length - 1]) {
    lines.pop();
  }
  while (lines.length > 0 && !lines[0]) {
    lines.shift();
  }
  return lines;
}

/** Returns the human-readable text of a tool output, or null when there is none. */
export function extractOutputText(output: unknown): string | null {
  if (output === null || output === undefined) {
    return null;
  }
  if (typeof output === 'string') {
    return output;
  }
  if (Array.isArray(output)) {
    const joined = output
      .map(part => {
        if (typeof part === 'string') return part;
        const record = asRecord(part);
        return typeof record?.text === 'string' ? record.text : '';
      })
      .filter(Boolean)
      .join('\n');
    return joined || null;
  }

  const record = asRecord(output);
  if (record) {
    if (typeof record.text === 'string') return record.text;
    if (typeof record.output === 'string') return record.output;
    if (typeof record.content === 'string') return record.content;
    if (Array.isArray(record.content)) return extractOutputText(record.content);
    if (typeof record.error === 'string') return record.error;
  }
  return null;
}

/**
 * Structured output (isError/is_error/error field) is still the primary
 * signal and is unconditionally trusted. Plain-string output only gets
 * flagged as an error under a tighter heuristic than a bare
 * `/^(error|failed)\b/i` first-line match: that misfired on any first line
 * that merely STARTS WITH the word, coloring documentation ("Error Codes")
 * and a successful grep whose first match line happens to read
 * "error: ..." bright red. Now it requires the first line to look like an
 * actual error header (the word immediately followed by `:` or `!`) AND
 * the whole output to be short — a real error is typically one line or a
 * short stack/message, while a multi-line search or file dump is not an
 * error just because a line inside it contains "error:".
 */
export function detectToolError(output: unknown): boolean {
  const record = asRecord(output);
  if (record) {
    if (record.isError === true || record.is_error === true) return true;
    if (record.error !== undefined && record.error !== null && record.error !== false) return true;
  }
  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (!trimmed) {
      return false;
    }
    const lines = trimmed.split('\n');
    return lines.length <= 3 && /^(error|failed)\s*[:!]/i.test(lines[0]);
  }
  return false;
}
