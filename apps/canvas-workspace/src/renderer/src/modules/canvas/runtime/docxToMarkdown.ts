import { strFromU8, unzipSync } from 'fflate';

/**
 * Converts a Word (.docx) file into Markdown so a dropped document becomes an
 * ordinary, editable note. It keeps the structure that matters for reading
 * and for agents: headings, paragraphs, lists, tables, links, and bold,
 * italic, or struck-through text. Images, comments, headers, and footers are
 * left out.
 */

const DOCUMENT_PART = 'word/document.xml';
const STYLES_PART = 'word/styles.xml';
const NUMBERING_PART = 'word/numbering.xml';
const RELS_PART = 'word/_rels/document.xml.rels';
const PARTS = new Set([DOCUMENT_PART, STYLES_PART, NUMBERING_PART, RELS_PART]);

const LIST_INDENT = '    ';
const PUNCTUATION_EDGE = /^([\s\p{P}]*)([\s\S]*?)([\s\p{P}]*)$/u;

interface DocxContext {
  /** Paragraph style id -> heading level and list numbering, with `basedOn` resolved. */
  paragraphStyles: Map<string, ParagraphStyle>;
  /** `${numId}:${ilvl}` -> true when that list level is numbered, not bulleted. */
  orderedLevels: Map<string, boolean>;
  /** Relationship id -> external hyperlink target. */
  links: Map<string, string>;
}

interface ParagraphStyle {
  /** Heading level (1-6), from the style's outline level or name. */
  heading?: number;
  numId?: string;
  ilvl?: string;
}

interface Segment {
  text: string;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  link?: string;
}

interface ListInfo {
  numId: string;
  level: number;
  ordered: boolean;
}

type Block =
  | { kind: 'paragraph'; text: string; heading?: number; list?: ListInfo }
  | { kind: 'table'; rows: string[][] };

const children = (element: Element, name?: string): Element[] => (
  Array.from(element.children).filter((child) => !name || child.localName === name)
);

const child = (element: Element | undefined, name: string): Element | undefined => (
  element ? children(element, name)[0] : undefined
);

/** Reads `w:val` (or another attribute) regardless of the namespace prefix. */
const attr = (element: Element | undefined, name = 'val'): string | null => {
  if (!element) return null;
  for (const attribute of Array.from(element.attributes)) {
    // Match on the qualified name too: some DOM implementations report
    // `w:val` as the local name.
    if (attribute.localName === name || attribute.name.endsWith(`:${name}`)) return attribute.value;
  }
  return null;
};

/** A `w:b`-style toggle is on unless its value says otherwise. */
const isOn = (element: Element | undefined): boolean => {
  if (!element) return false;
  const value = attr(element);
  return value !== 'false' && value !== '0' && value !== 'none';
};

const parseXml = (source: string | undefined): Document | null => {
  if (!source) return null;
  // The bytes are already decoded, so the XML declaration adds nothing. Some
  // parsers reject Word's single-quoted form, so drop it.
  const xml = source.replace(/^\uFEFF?<\?xml[^>]*\?>\s*/, '');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
};

const headingFromOutline = (pPr: Element | undefined): number | undefined => {
  const value = attr(child(pPr, 'outlineLvl'));
  if (value === null) return undefined;
  const level = Number(value);
  return Number.isInteger(level) && level >= 0 && level <= 5 ? level + 1 : undefined;
};

const headingFromStyleName = (name: string): number | undefined => {
  const normalized = name.trim().toLowerCase();
  if (normalized === 'title') return 1;
  const match = /^heading\s*([1-6])$/.exec(normalized);
  return match ? Number(match[1]) : undefined;
};

const MAX_STYLE_DEPTH = 10;

const readParagraphStyles = (styles: Document | null): Map<string, ParagraphStyle> => {
  const own = new Map<string, ParagraphStyle & { basedOn?: string }>();
  if (!styles?.documentElement) return new Map();
  for (const style of children(styles.documentElement, 'style')) {
    const id = attr(style, 'styleId');
    if (!id || attr(style, 'type') !== 'paragraph') continue;
    const pPr = child(style, 'pPr');
    const numPr = child(pPr, 'numPr');
    own.set(id, {
      basedOn: attr(child(style, 'basedOn')) ?? undefined,
      heading: headingFromOutline(pPr) ?? headingFromStyleName(attr(child(style, 'name')) ?? ''),
      numId: attr(child(numPr, 'numId')) ?? undefined,
      ilvl: attr(child(numPr, 'ilvl')) ?? undefined,
    });
  }
  // Built-in list styles such as "List Bullet" carry their numbering on the
  // style, and custom styles inherit it through `basedOn`.
  const resolve = (id: string, depth: number): ParagraphStyle => {
    const style = own.get(id);
    if (!style) return {};
    const parent = style.basedOn && depth < MAX_STYLE_DEPTH ? resolve(style.basedOn, depth + 1) : {};
    return {
      heading: style.heading ?? parent.heading,
      numId: style.numId ?? parent.numId,
      ilvl: style.ilvl ?? parent.ilvl,
    };
  };
  return new Map(Array.from(own.keys(), (id) => [id, resolve(id, 0)]));
};

const readOrderedLevels = (numbering: Document | null): Map<string, boolean> => {
  const result = new Map<string, boolean>();
  if (!numbering?.documentElement) return result;
  const abstractLevels = new Map<string, Map<string, boolean>>();
  for (const abstract of children(numbering.documentElement, 'abstractNum')) {
    const levels = new Map<string, boolean>();
    for (const lvl of children(abstract, 'lvl')) {
      const format = attr(child(lvl, 'numFmt')) ?? 'bullet';
      levels.set(attr(lvl, 'ilvl') ?? '0', format !== 'bullet' && format !== 'none');
    }
    abstractLevels.set(attr(abstract, 'abstractNumId') ?? '', levels);
  }
  for (const num of children(numbering.documentElement, 'num')) {
    const levels = abstractLevels.get(attr(child(num, 'abstractNumId')) ?? '');
    if (!levels) continue;
    for (const [ilvl, ordered] of levels) result.set(`${attr(num, 'numId')}:${ilvl}`, ordered);
  }
  return result;
};

const readLinks = (rels: Document | null): Map<string, string> => {
  const result = new Map<string, string>();
  if (!rels?.documentElement) return result;
  for (const rel of children(rels.documentElement, 'Relationship')) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (id && target && attr(rel, 'TargetMode') === 'External') result.set(id, target);
  }
  return result;
};

/** Escapes inline Markdown syntax and entity introducers such as `&copy;`. */
const escapeText = (text: string): string => text.replace(/([\\`*_[\]&])/g, '\\$1');

/** Escapes text at the start of a line that Markdown would read as a block:
 *  `# heading`, `- item`, `> quote`, `1. item`, `---`, and fences. */
const escapeLineStarts = (text: string): string => text
  .replace(/^([ \t]*)(?=#{1,6}(?:[ \t]|$)|>|[+-](?:[ \t]|$)|([=~-])\2)/gm, '$1\\')
  .replace(/^([ \t]*\d{1,9})([.)])(?=[ \t]|$)/gm, '$1\\$2');

const percentEncode = (char: string): string => (
  `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
);

/** Collects the text runs of a paragraph, including runs nested in links,
 *  tracked insertions, smart tags, and content controls. Deleted text is skipped. */
const collectSegments = (element: Element, ctx: DocxContext, link: string | undefined, out: Segment[]) => {
  for (const node of children(element)) {
    switch (node.localName) {
      case 'r': {
        const rPr = child(node, 'rPr');
        const format = {
          bold: isOn(child(rPr, 'b')),
          italic: isOn(child(rPr, 'i')),
          strike: isOn(child(rPr, 'strike')) || isOn(child(rPr, 'dstrike')),
          link,
        };
        for (const part of children(node)) {
          if (part.localName === 't') out.push({ ...format, text: part.textContent ?? '' });
          else if (part.localName === 'tab') out.push({ ...format, text: ' ' });
          else if (part.localName === 'br' || part.localName === 'cr') out.push({ ...format, text: '\n' });
        }
        break;
      }
      case 'hyperlink': {
        collectSegments(node, ctx, ctx.links.get(attr(node, 'id') ?? '') ?? link, out);
        break;
      }
      case 'del':
      case 'pPr':
      case 'rPr':
      case 'moveFrom':
        break;
      default:
        collectSegments(node, ctx, link, out);
    }
  }
};

const sameFormat = (a: Segment, b: Segment): boolean => (
  a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.link === b.link
);

/** Wraps text in emphasis markers. Leading and trailing spaces and punctuation
 *  stay outside the markers, so CommonMark still sees them as emphasis next to
 *  CJK text (for example `**需求**：` instead of `**需求：**`). */
const emphasize = (segment: Segment): string => {
  const marker = `${segment.bold ? '**' : ''}${segment.italic ? '*' : ''}${segment.strike ? '~~' : ''}`;
  if (!marker) return escapeText(segment.text);
  const [, lead = '', core = '', trail = ''] = PUNCTUATION_EDGE.exec(segment.text) ?? [];
  if (!core) return escapeText(segment.text);
  const closing = marker.split('').reverse().join('');
  return `${escapeText(lead)}${marker}${escapeText(core)}${closing}${escapeText(trail)}`;
};

const renderSegments = (segments: Segment[]): string => {
  const merged: Segment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && sameFormat(last, segment)) last.text += segment.text;
    else merged.push({ ...segment });
  }
  let out = '';
  let index = 0;
  while (index < merged.length) {
    const link = merged[index].link;
    let inner = '';
    while (index < merged.length && merged[index].link === link) {
      inner += emphasize(merged[index]);
      index += 1;
    }
    out += link && inner.trim() ? `[${inner}](${link.replace(/[()<>\s]/g, percentEncode)})` : inner;
  }
  return out;
};

const readParagraph = (p: Element, ctx: DocxContext): Block => {
  const pPr = child(p, 'pPr');
  const segments: Segment[] = [];
  collectSegments(p, ctx, undefined, segments);
  const text = escapeLineStarts(renderSegments(segments).replace(/[ \t]+\n/g, '\n').trim());
  const style = ctx.paragraphStyles.get(attr(child(pPr, 'pStyle')) ?? '') ?? {};
  const heading = headingFromOutline(pPr) ?? style.heading;
  const numPr = child(pPr, 'numPr');
  const numId = attr(child(numPr, 'numId')) ?? style.numId;
  if (numId && numId !== '0' && !heading) {
    const ilvl = attr(child(numPr, 'ilvl')) ?? style.ilvl ?? '0';
    return {
      kind: 'paragraph',
      text,
      list: { numId, level: Number(ilvl) || 0, ordered: ctx.orderedLevels.get(`${numId}:${ilvl}`) ?? false },
    };
  }
  return { kind: 'paragraph', text, heading };
};

const readCell = (cell: Element, ctx: DocxContext): string => {
  const lines: string[] = [];
  const visit = (element: Element) => {
    for (const node of children(element)) {
      if (node.localName === 'p') {
        const block = readParagraph(node, ctx);
        if (block.kind === 'paragraph' && block.text) lines.push(block.text);
      } else if (node.localName === 'tbl') {
        for (const row of readTable(node, ctx)) lines.push(row.filter(Boolean).join(' / '));
      } else if (node.localName === 'sdt' || node.localName === 'sdtContent') {
        visit(node);
      }
    }
  };
  visit(cell);
  // The note renderers disable HTML, so a cell cannot hold `<br>`. Its
  // paragraphs and line breaks become spaces.
  return lines.join(' ').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
};

function readTable(table: Element, ctx: DocxContext): string[][] {
  return children(table, 'tr').map((row) => {
    const cells: string[] = [];
    for (const cell of children(row, 'tc')) {
      cells.push(readCell(cell, ctx));
      const span = Number(attr(child(child(cell, 'tcPr'), 'gridSpan')) ?? '1');
      for (let extra = 1; extra < span; extra += 1) cells.push('');
    }
    return cells;
  });
}

const readBlocks = (container: Element, ctx: DocxContext, out: Block[]) => {
  for (const node of children(container)) {
    if (node.localName === 'p') out.push(readParagraph(node, ctx));
    else if (node.localName === 'tbl') out.push({ kind: 'table', rows: readTable(node, ctx) });
    else if (node.localName === 'sdt' || node.localName === 'sdtContent') readBlocks(node, ctx, out);
  }
};

const renderTable = (rows: string[][]): string => {
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (width === 0) return '';
  const line = (cells: string[]) => {
    const padded = [...cells, ...Array<string>(width - cells.length).fill('')];
    return `| ${padded.map((cell) => cell || ' ').join(' | ')} |`;
  };
  const [header, ...body] = rows;
  return [line(header), line(Array<string>(width).fill('---')), ...body.map(line)].join('\n');
};

const renderBlocks = (blocks: Block[]): string => {
  const parts: string[] = [];
  let listDepth = -1;
  // `${numId}:${level}` -> last number used. A Word list keeps counting after
  // a paragraph or table between its items, so counters live for the document.
  const counters = new Map<string, number>();
  for (const block of blocks) {
    if (block.kind === 'table') {
      listDepth = -1;
      const table = renderTable(block.rows);
      if (table) parts.push(table);
      continue;
    }
    if (!block.text) continue;
    if (block.list) {
      // A list item can nest at most one level below the item before it.
      const level = Math.min(block.list.level, listDepth + 1);
      const { numId, ordered } = block.list;
      // An item restarts the numbering of the deeper levels of its list.
      for (const key of Array.from(counters.keys())) {
        const [id, keyLevel] = key.split(':');
        if (id === numId && Number(keyLevel) > block.list.level) counters.delete(key);
      }
      const key = `${numId}:${block.list.level}`;
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      const marker = ordered ? `${count}.` : '-';
      const body = block.text.replace(/\n/g, `  \n${LIST_INDENT.repeat(level + 1)}`);
      const item = `${LIST_INDENT.repeat(level)}${marker} ${body}`;
      if (listDepth >= 0) parts[parts.length - 1] += `\n${item}`;
      else parts.push(item);
      listDepth = level;
      continue;
    }
    listDepth = -1;
    const text = block.heading
      ? `${'#'.repeat(block.heading)} ${block.text.replace(/\n+/g, ' ')}`
      : block.text.replace(/\n/g, '  \n');
    parts.push(text);
  }
  return parts.join('\n\n');
};

/** Converts the bytes of a .docx file to Markdown. Throws when the file is not
 *  a readable Word document. */
export const docxToMarkdown = (bytes: Uint8Array): string => {
  const files = unzipSync(bytes, { filter: (file) => PARTS.has(file.name) });
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : undefined);
  const document = parseXml(read(DOCUMENT_PART));
  const body = document?.documentElement ? child(document.documentElement, 'body') : undefined;
  if (!body) throw new Error('Not a Word document');
  const ctx: DocxContext = {
    paragraphStyles: readParagraphStyles(parseXml(read(STYLES_PART))),
    orderedLevels: readOrderedLevels(parseXml(read(NUMBERING_PART))),
    links: readLinks(parseXml(read(RELS_PART))),
  };
  const blocks: Block[] = [];
  readBlocks(body, ctx, blocks);
  return renderBlocks(blocks);
};
