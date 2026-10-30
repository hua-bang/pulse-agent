/**
 * Estimate a markdown note's height from its text, so agent-created cards
 * fit their content instead of all starting at the fixed default height
 * (short cards left mostly empty, long ones scrolling). The numbers follow
 * the reading-card type scale in the renderer (CanvasNodeBody/index.css for
 * the title, FileNodeBody/index.css for the text): a bold title of up to
 * three lines, then text at line-height 1.75 inside the card's padding, with
 * a roomier scale from 480px wide. The result is clamped, so a wrong guess
 * only costs some white space or a short scroll.
 */
const WIDE_CARD = 480;
const NARROW = { titleTop: 28, title: 22, padTop: 12, padBottom: 32, padX: 32, font: 15 };
const ROOMY = { titleTop: 36, title: 28, padTop: 16, padBottom: 40, padX: 44, font: 16 };
const TITLE_LINE_HEIGHT = 1.35;
const TITLE_MAX_LINES = 3;
const LINE_HEIGHT = 1.75;
const BORDER = 2;
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

export function estimateNoteHeight(content: string, width: number, title = ''): number {
  const scale = width >= WIDE_CARD ? ROOMY : NARROW;
  const font = scale.font;
  const lineHeight = font * LINE_HEIGHT;
  const listIndent = font * 1.55;
  const textWidth = Math.max(80, width - BORDER - scale.padX * 2);
  const heading = title.trim();
  const titleLines = heading ? Math.min(TITLE_MAX_LINES, wrappedLines(heading, textWidth, scale.title)) : 0;
  const blocks: Block[] = [];
  // The card hides a first heading that repeats its title.
  const lines = content.trimStart().split('\n');
  if (heading && /^#{1,6}\s+(.*)$/.exec(lines[0]?.trim() ?? '')?.[1].trim() === heading) lines.shift();
  let list: Block | null = null;
  let code: Block | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      if (code) {
        code = null;
      } else {
        code = { height: font * 1.6, marginTop: 0, marginBottom: font * 0.85 };
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

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (headingMatch) {
      const style = HEADINGS[Math.min(3, headingMatch[1].length)];
      const size = font * style.size;
      blocks.push({
        height: wrappedLines(headingMatch[2], textWidth, size) * size * style.lineHeight,
        marginTop: size * style.top,
        marginBottom: size * style.bottom,
      });
      list = null;
    } else if (item) {
      if (!list) {
        list = { height: 0, marginTop: font * 0.35, marginBottom: font * 0.85 };
        blocks.push(list);
      } else {
        list.height += font * 0.3; // the collapsed margin between two items
      }
      list.height += wrappedLines(item[1], textWidth - listIndent, font) * lineHeight;
    } else if (/^\|/.test(line)) {
      if (/^\|[\s:|-]+\|?$/.test(line)) continue; // table separator row
      blocks.push({ height: lineHeight + 12, marginTop: 0, marginBottom: 0 });
      list = null;
    } else {
      const quote = line.startsWith('>');
      const text = quote ? line.replace(/^>\s*/, '') : line;
      blocks.push({
        height: wrappedLines(text, textWidth - (quote ? font * 1.05 : 0), font) * lineHeight,
        marginTop: quote ? font * 0.2 : 0,
        marginBottom: quote ? font * 0.95 : font * 0.65,
      });
      list = null;
    }
  }

  // The first block's top margin stays out (the first heading has none);
  // adjacent margins collapse to the larger one, as in CSS.
  let height = BORDER + scale.titleTop + titleLines * scale.title * TITLE_LINE_HEIGHT
    + scale.padTop + scale.padBottom;
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
