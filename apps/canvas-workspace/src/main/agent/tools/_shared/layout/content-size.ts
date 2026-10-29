/**
 * Estimate a markdown note's height from its text, so agent-created cards
 * fit their content instead of all starting at the fixed default height
 * (short cards left mostly empty, long ones scrolling). The numbers approximate
 * the note editor's type scale; the result is clamped, so a wrong guess only
 * costs some white space or a short scroll.
 */
const CHROME_HEIGHT = 72; // node header + body padding
const LINE_HEIGHT = 22;
const HEADING_LINE_FACTOR = 1.4;
const BLANK_LINE_FACTOR = 0.6;
const HORIZONTAL_PADDING = 32;
const LATIN_CHAR_WIDTH = 7.5;
const WIDE_CHAR_WIDTH = 14;
export const MIN_NOTE_HEIGHT = 160;
export const MAX_NOTE_HEIGHT = 640;

// CJK ideographs, kana, Hangul, and full-width forms render about twice as wide.
const WIDE_CHAR = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

export function estimateNoteHeight(content: string, width: number): number {
  const available = Math.max(80, width - HORIZONTAL_PADDING);
  let lines = 0;
  for (const line of content.split('\n')) {
    const text = line.trim();
    if (!text) {
      lines += BLANK_LINE_FACTOR;
      continue;
    }
    let lineWidth = 0;
    for (const char of text) lineWidth += WIDE_CHAR.test(char) ? WIDE_CHAR_WIDTH : LATIN_CHAR_WIDTH;
    const wrapped = Math.max(1, Math.ceil(lineWidth / available));
    lines += /^#{1,6}\s/.test(text) ? wrapped * HEADING_LINE_FACTOR : wrapped;
  }
  const height = CHROME_HEIGHT + lines * LINE_HEIGHT;
  return Math.round(Math.min(MAX_NOTE_HEIGHT, Math.max(MIN_NOTE_HEIGHT, height)) / 8) * 8;
}
