import {
  attr,
  child,
  children,
  descendant,
  escapeLineStarts,
  escapeText,
  parseXml,
  readZipParts,
  relationshipId,
  renderTable,
  tableCell,
  type XmlElement,
} from './ooxml';

/**
 * Converts a PowerPoint (.pptx) file into Markdown: one section per slide in
 * presentation order, with the slide title as the heading, body placeholders
 * as nested bullets, other text boxes as paragraphs, tables as Markdown
 * tables, and speaker notes at the end of each slide. Images and charts are
 * left out.
 */

const PRESENTATION_PART = 'ppt/presentation.xml';
const PRESENTATION_RELS_PART = 'ppt/_rels/presentation.xml.rels';
const SLIDE_PATTERN = /^ppt\/slides\/slide(\d+)\.xml$/;
const SLIDE_RELS_PATTERN = /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/;
const NOTES_PATTERN = /^ppt\/notesSlides\/notesSlide\d+\.xml$/;
const LIST_INDENT = '    ';
const TITLE_TYPES = new Set(['title', 'ctrTitle']);

interface Relationship {
  type: string;
  target: string;
}

/** Resolves a relationship target against the folder of the part that owns it. */
const resolveTarget = (ownerPart: string, target: string): string => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ownerPart.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
};

/** Reads `<owner>/_rels/<name>.rels` and returns relationship id -> resolved target. */
const readRelationships = (
  files: Map<string, string>,
  ownerPart: string,
): Map<string, Relationship> => {
  const folder = ownerPart.split('/').slice(0, -1).join('/');
  const name = ownerPart.split('/').pop() ?? '';
  const rels = parseXml(files.get(`${folder}/_rels/${name}.rels`));
  const result = new Map<string, Relationship>();
  if (!rels) return result;
  for (const rel of children(rels, 'Relationship')) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (!id || !target || attr(rel, 'TargetMode') === 'External') continue;
    result.set(id, { type: attr(rel, 'Type') ?? '', target: resolveTarget(ownerPart, target) });
  }
  return result;
};

/** Slide parts in presentation order, falling back to slide number order. */
const slideOrder = (files: Map<string, string>): string[] => {
  const presentation = parseXml(files.get(PRESENTATION_PART));
  const rels = readRelationships(files, PRESENTATION_PART);
  const list = presentation ? child(presentation, 'sldIdLst') : undefined;
  const ordered = list
    ? children(list, 'sldId')
      .map((slide) => rels.get(relationshipId(slide) ?? '')?.target)
      .filter((part): part is string => !!part && files.has(part))
    : [];
  if (ordered.length > 0) return ordered;
  return Array.from(files.keys())
    .filter((name) => SLIDE_PATTERN.test(name))
    .sort((a, b) => Number(SLIDE_PATTERN.exec(a)?.[1]) - Number(SLIDE_PATTERN.exec(b)?.[1]));
};

/** Text of one `a:p` paragraph: runs, fields, and line breaks. */
const paragraphText = (paragraph: XmlElement): string => {
  let text = '';
  const visit = (element: XmlElement) => {
    for (const node of children(element)) {
      if (node.localName === 't') text += node.textContent ?? '';
      else if (node.localName === 'br') text += '\n';
      else if (node.localName !== 'rPr' && node.localName !== 'pPr') visit(node);
    }
  };
  visit(paragraph);
  return text.trim();
};

const textBodyParagraphs = (body: XmlElement | undefined): Array<{ text: string; level: number }> => (
  body
    ? children(body, 'p')
      .map((paragraph) => ({
        text: paragraphText(paragraph),
        level: Number(attr(child(paragraph, 'pPr'), 'lvl') ?? '0') || 0,
      }))
      .filter((paragraph) => paragraph.text)
    : []
);

const placeholderType = (shape: XmlElement): string | null | undefined => {
  const ph = child(child(child(shape, 'nvSpPr'), 'nvPr'), 'ph');
  if (!ph) return undefined;
  return attr(ph, 'type');
};

const markdownLine = (text: string): string => escapeLineStarts(escapeText(text)).replace(/\n/g, '  \n');

interface SlideContent {
  title: string;
  blocks: string[];
}

const readTable = (table: XmlElement): string => renderTable(
  children(table, 'tr').map((row) => children(row, 'tc').map((cell) => tableCell(
    textBodyParagraphs(child(cell, 'txBody')).map((paragraph) => paragraph.text).join(' '),
  ))),
);

/** Walks a shape tree in document order, including grouped shapes. */
const readShapes = (tree: XmlElement, slide: SlideContent) => {
  for (const node of children(tree)) {
    if (node.localName === 'grpSp') {
      readShapes(node, slide);
    } else if (node.localName === 'graphicFrame') {
      const table = descendant(node, 'tbl');
      if (table) slide.blocks.push(readTable(table));
    } else if (node.localName === 'sp') {
      const paragraphs = textBodyParagraphs(child(node, 'txBody'));
      if (paragraphs.length === 0) continue;
      const type = placeholderType(node);
      if (type && TITLE_TYPES.has(type) && !slide.title) {
        slide.title = paragraphs.map((paragraph) => paragraph.text).join(' ').replace(/\s+/g, ' ');
      } else if (type !== undefined) {
        // Body placeholders hold the slide's bullet points.
        slide.blocks.push(paragraphs
          .map(({ text, level }) => `${LIST_INDENT.repeat(level)}- ${markdownLine(text)}`)
          .join('\n'));
      } else {
        slide.blocks.push(paragraphs.map(({ text }) => markdownLine(text)).join('\n\n'));
      }
    }
  }
};

const shapeTree = (doc: XmlElement | null): XmlElement | undefined => (
  doc ? child(child(doc, 'cSld'), 'spTree') : undefined
);

/** Speaker notes: the notes slide's body placeholder, without the slide image or number. */
const readNotes = (files: Map<string, string>, slidePart: string): string => {
  const notesRel = Array.from(readRelationships(files, slidePart).values())
    .find((rel) => rel.type.endsWith('/notesSlide'));
  const tree = notesRel ? shapeTree(parseXml(files.get(notesRel.target))) : undefined;
  if (!tree) return '';
  const lines: string[] = [];
  for (const shape of children(tree, 'sp')) {
    if (placeholderType(shape) !== 'body') continue;
    for (const { text } of textBodyParagraphs(child(shape, 'txBody'))) lines.push(markdownLine(text));
  }
  return lines.join('\n\n');
};

/** Converts the bytes of a .pptx file to Markdown. Throws when the file is not
 *  a readable PowerPoint presentation. */
export const pptxToMarkdown = (bytes: Uint8Array): string => {
  const files = readZipParts(bytes, (name) => (
    name === PRESENTATION_PART
    || name === PRESENTATION_RELS_PART
    || SLIDE_PATTERN.test(name)
    || SLIDE_RELS_PATTERN.test(name)
    || NOTES_PATTERN.test(name)
  ));
  if (!files.has(PRESENTATION_PART)) throw new Error('Not a PowerPoint presentation');
  const sections = slideOrder(files).map((part, index) => {
    const slide: SlideContent = { title: '', blocks: [] };
    const tree = shapeTree(parseXml(files.get(part)));
    if (tree) readShapes(tree, slide);
    const heading = `## Slide ${index + 1}${slide.title ? `: ${escapeText(slide.title)}` : ''}`;
    const notes = readNotes(files, part);
    return [heading, ...slide.blocks, ...(notes ? [`**Notes**\n\n${notes}`] : [])].join('\n\n');
  });
  return sections.join('\n\n');
};
