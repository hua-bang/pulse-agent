const MAX_EVENT_TEXT_LENGTH = 20000;

/**
 * A bare `text.slice(0, MAX_EVENT_TEXT_LENGTH)` can land the cut mid-way
 * through an ANSI escape sequence or inside a markdown code fence — the
 * escape then never closes and everything the renderer draws after it
 * inherits whatever SGR state was left open, and an unclosed ``` fence
 * makes every following line render as literal code. Cuts instead at the
 * last newline before the limit so the break falls on a natural boundary;
 * only text with no newline at all in range falls back to a hard cut, and
 * that hard cut itself must not split a surrogate pair or a still-open
 * ANSI sequence.
 */
export function truncateEventText(text: string): string {
  if (text.length <= MAX_EVENT_TEXT_LENGTH) {
    return text;
  }

  const cut = findTruncationCut(text, MAX_EVENT_TEXT_LENGTH);
  const prefix = text.slice(0, cut);
  const openFence = countFenceMarkers(prefix) % 2 === 1;
  return openFence ? `${prefix}\n\`\`\`\n…` : `${prefix}\n…`;
}

/** Last newline at or before `limit`; falls back to a codepoint/ANSI-safe hard cut when there is none. */
function findTruncationCut(text: string, limit: number): number {
  const lastNewline = text.lastIndexOf('\n', limit);
  return lastNewline > 0 ? lastNewline : safeHardCut(text, limit);
}

/** A hard cut that never splits a surrogate pair or an in-progress ANSI SGR sequence. */
function safeHardCut(text: string, limit: number): number {
  let cut = Math.min(limit, text.length);

  // Cutting between a high and low surrogate leaves two lone, unrenderable
  // code units either side of the cut.
  if (cut > 0 && cut < text.length) {
    const code = text.charCodeAt(cut - 1);
    if (code >= 0xd8_00 && code <= 0xdb_ff) {
      cut -= 1;
    }
  }

  // Back up to the start of the last escape sequence still open at the cut
  // (started but not yet closed with a final 'm').
  const lastEscape = text.lastIndexOf('\x1b', cut - 1);
  if (lastEscape >= 0 && !/^\x1b\[[0-9;]*m/.test(text.slice(lastEscape, cut))) {
    cut = lastEscape;
  }

  return cut;
}

/** Counts ``` fence markers so a truncated prefix can be closed off before the ellipsis. */
function countFenceMarkers(text: string): number {
  return text.match(/```/g)?.length ?? 0;
}
