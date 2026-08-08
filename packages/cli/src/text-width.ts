/**
 * Terminal text measurement and code-point-aware cursor stepping.
 *
 * `String.length` counts UTF-16 code units, which is wrong twice over in a
 * terminal: a CJK glyph occupies two columns but one unit, and an emoji
 * occupies two columns but *two* units (a surrogate pair). Layout math must
 * use display width; cursor math must step whole code points.
 */

const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f],   // Hangul Jamo
  [0x2e80, 0x303e],   // CJK radicals, Kangxi
  [0x3041, 0x33ff],   // Hiragana .. CJK compatibility
  [0x3400, 0x4dbf],   // CJK ext A
  [0x4e00, 0x9fff],   // CJK unified
  [0xa000, 0xa4cf],   // Yi
  [0xac00, 0xd7a3],   // Hangul syllables
  [0xf900, 0xfaff],   // CJK compatibility ideographs
  [0xfe30, 0xfe4f],   // CJK compatibility forms
  [0xff00, 0xff60],   // Fullwidth forms
  [0xffe0, 0xffe6],   // Fullwidth signs
  [0x1f300, 0x1f64f], // Emoji: symbols & pictographs, emoticons
  [0x1f680, 0x1f6ff], // Emoji: transport
  [0x1f900, 0x1f9ff], // Emoji: supplemental
  [0x20000, 0x3fffd], // CJK ext B+
];

/** Columns a single code point occupies (0 for combining marks, 2 for wide). */
export function charWidth(codePoint: number): number {
  if (codePoint === 0) {
    return 0;
  }
  // Combining marks render on top of the previous glyph.
  if (codePoint >= 0x0300 && codePoint <= 0x036f) {
    return 0;
  }
  // Variation selectors / ZWJ carry no width of their own.
  if (codePoint === 0x200d || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) {
    return 0;
  }
  return WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end) ? 2 : 1;
}

/** Display columns the string occupies in a terminal. */
export function stringWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += charWidth(char.codePointAt(0) ?? 0);
  }
  return width;
}

/**
 * Truncates to a display-column budget, appending `…` (1 column) when cut.
 * Never splits a surrogate pair.
 */
export function truncateToWidth(value: string, maxWidth: number): string {
  if (!Number.isFinite(maxWidth) || maxWidth <= 1 || stringWidth(value) <= maxWidth) {
    return value;
  }

  let width = 0;
  let result = '';
  for (const char of value) {
    const next = charWidth(char.codePointAt(0) ?? 0);
    if (width + next > maxWidth - 1) {
      break;
    }
    width += next;
    result += char;
  }
  return `${result}…`;
}

// SGR sequences colour a glyph without occupying a column of their own, so
// anything measuring already-rendered (markdown → ANSI) text must drop them
// first or it over-counts every styled line.
const ANSI_SGR_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Physical rows one logical line occupies once the terminal wraps it at
 * `columns`. Greedy word wrap, matching Ink's default `wrap`: a word that does
 * not fit on a line of its own is hard-split across rows.
 *
 * A row budget computed from `String.split('\n').length` is wrong whenever a
 * line is wider than the terminal — that undercount is what lets a "bounded"
 * region overflow the screen.
 */
export function wrappedRowCount(line: string, columns: number): number {
  if (!Number.isFinite(columns) || columns <= 0) {
    return 1;
  }

  const plain = line.replace(ANSI_SGR_PATTERN, '');
  if (stringWidth(plain) <= columns) {
    return 1;
  }

  let rows = 1;
  let used = 0;
  for (const word of plain.split(' ')) {
    const wordWidth = stringWidth(word);
    const gap = used > 0 ? 1 : 0;
    if (used + gap + wordWidth <= columns) {
      used += gap + wordWidth;
      continue;
    }

    if (used > 0) {
      rows += 1;
      used = 0;
    }

    // Words wider than the terminal (long paths, unspaced CJK) fill whole rows.
    let remaining = wordWidth;
    while (remaining > columns) {
      rows += 1;
      remaining -= columns;
    }
    used = remaining;
  }

  return rows;
}

/** Index of the code point boundary before `index` (for ←/Backspace). */
export function prevCharIndex(value: string, index: number): number {
  const position = Math.max(0, Math.min(value.length, index));
  if (position === 0) {
    return 0;
  }
  const before = value.slice(0, position);
  const chars = Array.from(before);
  const last = chars[chars.length - 1] ?? '';
  return position - last.length;
}

/** Index of the code point boundary after `index` (for →/Delete). */
export function nextCharIndex(value: string, index: number): number {
  const position = Math.max(0, Math.min(value.length, index));
  if (position >= value.length) {
    return value.length;
  }
  const after = value.slice(position);
  const first = Array.from(after)[0] ?? '';
  return position + first.length;
}
