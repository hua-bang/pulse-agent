// While a reply streams, only its last block still changes. This finds where
// the finished blocks end, so the stream can render them once and re-render
// only the rest.
//
// A split is safe before a line that starts a new top-level block:
// - after a blank line or a closing code fence, when the line cannot continue
//   the block above it (a list item, an indented line, or a quote line can);
// - before a code fence at the start of a line, which always opens a block.
// The last line may still grow, so it never decides a split. Text only grows
// during a stream, so a split found once stays valid.

export const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const CONTINUATION_RE = /^(\s|>|[-*+]\s|\d+[.)]\s)/;

/** True when `line` closes a fence that `opener` opened. */
export const closesFence = (line: string, opener: string): boolean => {
  const marker = FENCE_RE.exec(line)?.[1];
  return !!marker
    && marker[0] === opener[0]
    && marker.length >= opener.length
    && !line.trim().slice(marker.length).trim();
};

/**
 * Returns the offset where the finished blocks of `text` end, or `from` when
 * no new block finished after `from`. `from` must be a value this function
 * returned earlier for a prefix of `text`, or 0.
 */
export const settledMarkdownEnd = (text: string, from = 0): number => {
  let end = from;
  let fence: string | null = null;
  let afterBlock = false;
  let lineStart = from;
  while (lineStart < text.length) {
    const newline = text.indexOf('\n', lineStart);
    if (newline < 0) break;
    const line = text.slice(lineStart, newline);
    if (fence) {
      if (closesFence(line, fence)) {
        fence = null;
        afterBlock = true;
      }
    } else {
      const marker = FENCE_RE.exec(line)?.[1];
      const opensAtColumnZero = !!marker && line.startsWith(marker);
      const startsBlock = afterBlock && !!line.trim() && !CONTINUATION_RE.test(line);
      if (lineStart > from && (opensAtColumnZero || startsBlock)) end = lineStart;
      if (marker) fence = marker;
      afterBlock = !line.trim();
    }
    lineStart = newline + 1;
  }
  return end;
};
