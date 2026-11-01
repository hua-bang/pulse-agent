import { loadedHighlighter } from '../../../../../utils/syntaxHighlighter';
import { closesFence, FENCE_RE } from './settledEnd';

// A long code block is one Markdown block, so it stays in the unfinished tail
// until it closes. Re-rendering it on every update re-highlights and lays out
// the whole block each time. Instead, the stream appends each finished line
// to the block that is already in the DOM.

export interface OpenFence {
  /** The opening line, without its newline. */
  opener: string;
  marker: string;
  lang: string;
  /** Offset of the first code character in the tail. */
  codeStart: number;
  /**
   * Offset of the closing fence line, when the block has just closed but no
   * full line follows it yet. The block then stays in the tail until the
   * next block starts.
   */
  codeEnd: number | null;
}

/** Returns the code block that opens `tail` and is its only finished block, or null. */
export const openFenceAt = (tail: string): OpenFence | null => {
  const firstNewline = tail.indexOf('\n');
  if (firstNewline < 0) return null;
  const opener = tail.slice(0, firstNewline);
  const marker = FENCE_RE.exec(opener)?.[1];
  if (!marker || !opener.startsWith(marker)) return null;
  const lang = opener.slice(marker.length).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  // Mermaid renders as a diagram placeholder, not as code lines.
  if (lang === 'mermaid' || (marker[0] === '`' && lang.includes('`'))) return null;
  let lineStart = firstNewline + 1;
  while (lineStart < tail.length) {
    const newline = tail.indexOf('\n', lineStart);
    const line = tail.slice(lineStart, newline < 0 ? tail.length : newline);
    if (newline >= 0 && closesFence(line, marker)) {
      const rest = tail.slice(newline + 1);
      const restFinished = rest.slice(0, rest.lastIndexOf('\n') + 1);
      if (restFinished.trim()) return null;
      return { opener, marker, lang, codeStart: firstNewline + 1, codeEnd: lineStart };
    }
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  return { opener, marker, lang, codeStart: firstNewline + 1, codeEnd: null };
};

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/**
 * Highlights finished code lines on their own. A token that spans a batch
 * boundary (a block comment, for example) may color differently until the
 * block closes and renders as a whole.
 */
export const highlightLines = (code: string, lang: string): string => {
  const hljs = loadedHighlighter();
  if (!hljs || !lang || !hljs.getLanguage(lang)) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
};

/**
 * When `segment` is exactly the block that `opener` opened (its code, the
 * closing fence line, and blank lines), returns the code. The finished block
 * can then keep the lines already in the DOM instead of rendering again.
 */
export const closedFenceCode = (segment: string, opener: string, marker: string): string | null => {
  if (!segment.startsWith(`${opener}\n`)) return null;
  let lineStart = opener.length + 1;
  while (lineStart < segment.length) {
    const newline = segment.indexOf('\n', lineStart);
    const lineEnd = newline < 0 ? segment.length : newline;
    if (closesFence(segment.slice(lineStart, lineEnd), marker)) {
      return segment.slice(lineEnd).trim() ? null : segment.slice(opener.length + 1, lineStart);
    }
    lineStart = lineEnd + 1;
  }
  return null;
};
