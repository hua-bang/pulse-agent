/**
 * Estimate a markdown note's height from its text, so agent-created cards
 * fit their content instead of all starting at the fixed default height
 * (short cards left mostly empty, long ones scrolling). The numbers follow
 * the card editor's type scale in the renderer's FileNodeBody/index.css:
 * 15px text at line-height 1.7, a 1.5em H1, list and paragraph margins, and
 * the editor's 20px top and 72px bottom padding. The result is clamped, so a
 * wrong guess only costs some white space or a short scroll.
 */
const NODE_HEADER = 34;
const EDITOR_PADDING_TOP = 20;
const EDITOR_PADDING_BOTTOM = 72;
const EDITOR_PADDING_X = 28;
const EDITOR_MAX_WIDTH = 800;
const FONT = 15;
const LINE = FONT * 1.7;
const LIST_INDENT = FONT * 1.55;
const LATIN_CHAR_EM = 0.55;
export const MIN_NOTE_HEIGHT = 160;
export const MAX_NOTE_HEIGHT = 640;

// CJK ideographs, kana, Hangul, and full-width forms are one em wide.
const WIDE_CHAR = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

interface Block {
  height: number;
  marginTop: number;
  marginBottom: number;
}

const HEADINGS: Record<number, { size: number; lineHeight: number; top: number; bottom: number }> = {
  1: { size: 1.5, lineHeight: 1.4, top: 1.2, bottom: 0.5 },
  2: { size: 1.25, lineHeight: 1.45, top: 1.35, bottom: 0.5 },
  3: { size: 1.1, lineHeight: 1.5, top: 1.2, bottom: 0.4 },
};

export function estimateNoteHeight(content: string, width: number): number {
  const textWidth = Math.max(80, Math.min(width, EDITOR_MAX_WIDTH) - EDITOR_PADDING_X * 2);
  const blocks: Block[] = [];
  let list: Block | null = null;
  let code: Block | null = null;

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      if (code) {
        code = null;
      } else {
        code = { height: FONT * 1.6, marginTop: 0, marginBottom: FONT * 0.85 };
        blocks.push(code);
      }
      list = null;
      continue;
    }
    if (code) {
      code.height += 22;
      continue;
    }
    if (!line) {
      list = null;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (heading) {
      const style = HEADINGS[Math.min(3, heading[1].length)];
      const size = FONT * style.size;
      blocks.push({
        height: wrappedLines(heading[2], textWidth, size) * size * style.lineHeight,
        marginTop: size * style.top,
        marginBottom: size * style.bottom,
      });
      list = null;
    } else if (item) {
      if (!list) {
        list = { height: 0, marginTop: FONT * 0.35, marginBottom: FONT * 0.85 };
        blocks.push(list);
      } else {
        list.height += FONT * 0.3; // the collapsed margin between two items
      }
      list.height += wrappedLines(item[1], textWidth - LIST_INDENT, FONT) * LINE;
    } else if (/^\|/.test(line)) {
      if (/^\|[\s:|-]+\|?$/.test(line)) continue; // table separator row
      blocks.push({ height: LINE + 12, marginTop: 0, marginBottom: 0 });
      list = null;
    } else {
      const quote = line.startsWith('>');
      const text = quote ? line.replace(/^>\s*/, '') : line;
      blocks.push({
        height: wrappedLines(text, textWidth - (quote ? FONT * 1.05 : 0), FONT) * LINE,
        marginTop: quote ? FONT * 0.2 : 0,
        marginBottom: quote ? FONT * 0.95 : FONT * 0.65,
      });
      list = null;
    }
  }

  // The first block's top margin stays out (the first heading has none);
  // adjacent margins collapse to the larger one, as in CSS.
  let height = NODE_HEADER + EDITOR_PADDING_TOP + EDITOR_PADDING_BOTTOM;
  blocks.forEach((block, index) => {
    height += block.height;
    if (index > 0) height += Math.max(blocks[index - 1].marginBottom, block.marginTop);
  });
  if (blocks.length > 0) height += blocks[blocks.length - 1].marginBottom;
  return Math.ceil(Math.min(MAX_NOTE_HEIGHT, Math.max(MIN_NOTE_HEIGHT, height)) / 8) * 8;
}

function wrappedLines(text: string, width: number, fontSize: number): number {
  // Inline markdown markers do not render.
  const visible = text.replace(/\*\*|__|`|~~|\[([^\]]*)\]\([^)]*\)/g, '$1');
  let lineWidth = 0;
  for (const char of visible) lineWidth += WIDE_CHAR.test(char) ? fontSize : fontSize * LATIN_CHAR_EM;
  return Math.max(1, Math.ceil(lineWidth / Math.max(40, width)));
}
