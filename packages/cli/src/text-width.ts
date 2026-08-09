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
  // BMP emoji with default emoji presentation (Unicode Emoji_Presentation):
  // terminals render these two columns wide even without a VS16. The everyday
  // status glyphs (✅ ❌ ⭐ ⏳ …) live here — undercounting them broke
  // truncation and row budgets by one column per glyph. Textual siblings like
  // ✓ (0x2713) and ⚠ (0x26a0) stay narrow on purpose; VS16 upgrades them.
  [0x231a, 0x231b],   // ⌚⌛
  [0x23e9, 0x23ec],   // ⏩⏪⏫⏬
  [0x23f0, 0x23f0],   // ⏰
  [0x23f3, 0x23f3],   // ⏳
  [0x25fd, 0x25fe],   // ◽◾
  [0x2614, 0x2615],   // ☔☕
  [0x2648, 0x2653],   // zodiac
  [0x267f, 0x267f],   // ♿
  [0x2693, 0x2693],   // ⚓
  [0x26a1, 0x26a1],   // ⚡
  [0x26aa, 0x26ab],   // ⚪⚫
  [0x26bd, 0x26be],   // ⚽⚾
  [0x26c4, 0x26c5],   // ⛄⛅
  [0x26ce, 0x26ce],   // ⛎
  [0x26d4, 0x26d4],   // ⛔
  [0x26ea, 0x26ea],   // ⛪
  [0x26f2, 0x26f3],   // ⛲⛳
  [0x26f5, 0x26f5],   // ⛵
  [0x26fa, 0x26fa],   // ⛺
  [0x26fd, 0x26fd],   // ⛽
  [0x2705, 0x2705],   // ✅
  [0x270a, 0x270b],   // ✊✋
  [0x2728, 0x2728],   // ✨
  [0x274c, 0x274c],   // ❌
  [0x274e, 0x274e],   // ❎
  [0x2753, 0x2755],   // ❓❔❕
  [0x2757, 0x2757],   // ❗
  [0x2795, 0x2797],   // ➕➖➗
  [0x27b0, 0x27b0],   // ➰
  [0x27bf, 0x27bf],   // ➿
  [0x2b1b, 0x2b1c],   // ⬛⬜
  [0x2b50, 0x2b50],   // ⭐
  [0x2b55, 0x2b55],   // ⭕
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

/**
 * VS16 (U+FE0F) flips a narrow text-presentation symbol (⚠ ℹ ✔ …) into its
 * emoji presentation, which terminals draw two columns wide. The selector
 * itself is zero-width, so the pair costs prev+1 — but only when the base was
 * a narrow symbol: after an already-wide glyph or ordinary text VS16 changes
 * nothing.
 */
function vs16Extra(codePoint: number, prevCodePoint: number | null): number {
  return codePoint === 0xfe0f
    && prevCodePoint !== null
    && prevCodePoint >= 0x2000
    && charWidth(prevCodePoint) === 1
    ? 1
    : 0;
}

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
  let prev: number | null = null;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    width += charWidth(codePoint) + vs16Extra(codePoint, prev);
    prev = codePoint;
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
  let prev: number | null = null;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    const next = charWidth(codePoint) + vs16Extra(codePoint, prev);
    if (width + next > maxWidth - 1) {
      break;
    }
    width += next;
    result += char;
    prev = codePoint;
  }
  return `${result}…`;
}

// SGR sequences colour a glyph without occupying a column of their own, so
// anything measuring already-rendered (markdown → ANSI) text must drop them
// first or it over-counts every styled line.
const ANSI_SGR_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * The physical rows a terminal wraps one logical line onto at `columns`.
 * Greedy word wrap, matching Ink's default `wrap`: a word that does not fit on
 * a line of its own is hard-split across rows.
 *
 * Rendering these rows instead of the raw line is what lets a region budget its
 * own height exactly — every returned row fits `columns`, so Ink cannot reflow
 * one into extra rows behind the budget's back.
 */
export function wrapToRows(line: string, columns: number): string[] {
  if (!Number.isFinite(columns) || columns <= 0) {
    return [line];
  }

  // Terminals advance a tab to the next 8-column stop; measuring it as one
  // column undercounted tab-indented code and let the frame outgrow the
  // viewport. Expansion assumes the line starts at column 0, which holds for
  // every region this budgets (each logical line renders from the left edge).
  const plain = expandTabs(line.replace(ANSI_SGR_PATTERN, ''));
  if (stringWidth(plain) <= columns) {
    return [plain];
  }

  const rows: string[] = [];
  // Leading indentation is real columns (Ink wraps with trim:false): the
  // word-split below charges inter-word gaps only when something precedes
  // them, which silently swallowed a leading run — an 8-column tab indent
  // measured as 0 and the row budget undercounted every indented code line.
  const leading = plain.match(/^ +/)?.[0] ?? '';
  let remainingLead = leading;
  while (stringWidth(remainingLead) > columns) {
    rows.push(remainingLead.slice(0, columns));
    remainingLead = remainingLead.slice(columns);
  }
  let current = remainingLead;
  let used = stringWidth(remainingLead);
  // A gap column precedes a word only when another WORD is already on the
  // row — the seeded indentation IS the separator, so the first word after
  // it must not pay (or render) an extra space.
  let wordsOnRow = 0;
  for (const word of plain.slice(leading.length).split(' ')) {
    const wordWidth = stringWidth(word);
    const gap = wordsOnRow > 0 ? 1 : 0;
    if (used + gap + wordWidth <= columns) {
      current += gap > 0 ? ` ${word}` : word;
      used += gap + wordWidth;
      wordsOnRow += 1;
      continue;
    }

    if (used > 0) {
      rows.push(current);
      current = '';
      used = 0;
      wordsOnRow = 0;
    }

    // Words wider than the terminal (long paths, base64, unspaced CJK) fill
    // whole rows on their own.
    let remaining = word;
    while (stringWidth(remaining) > columns) {
      // A single glyph wider than the terminal still has to go somewhere, or
      // the split loop would never consume it.
      const head = takeWidth(remaining, columns) || Array.from(remaining)[0];
      rows.push(head);
      remaining = remaining.slice(head.length);
    }
    current = remaining;
    used = stringWidth(remaining);
    wordsOnRow = remaining ? 1 : 0;
  }

  rows.push(current);
  return rows;
}

/**
 * Physical rows one logical line occupies once the terminal wraps it at
 * `columns`.
 *
 * A row budget computed from `String.split('\n').length` is wrong whenever a
 * line is wider than the terminal — that undercount is what lets a "bounded"
 * region overflow the screen.
 */
export function wrappedRowCount(line: string, columns: number): number {
  return wrapToRows(line, columns).length;
}

/** Expands tabs to 8-column terminal stops, counting columns in display width. */
function expandTabs(value: string, tabStop = 8): string {
  if (!value.includes('\t')) {
    return value;
  }

  let result = '';
  let column = 0;
  let prev: number | null = null;
  for (const char of value) {
    if (char === '\t') {
      const spaces = tabStop - (column % tabStop);
      result += ' '.repeat(spaces);
      column += spaces;
      prev = 0x20;
      continue;
    }
    const codePoint = char.codePointAt(0) ?? 0;
    column += charWidth(codePoint) + vs16Extra(codePoint, prev);
    result += char;
    prev = codePoint;
  }
  return result;
}

/** Longest prefix fitting `maxWidth` display columns, never splitting a glyph. */
function takeWidth(value: string, maxWidth: number): string {
  let width = 0;
  let result = '';
  let prev: number | null = null;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    const next = charWidth(codePoint) + vs16Extra(codePoint, prev);
    if (width + next > maxWidth) {
      break;
    }
    width += next;
    result += char;
    prev = codePoint;
  }
  return result;
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
