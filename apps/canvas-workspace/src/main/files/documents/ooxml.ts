import { strFromU8, unzipSync } from 'fflate';
import { parseXmlElement, type XmlElement } from './xml';

export type { XmlElement };

/**
 * Shared helpers for Office Open XML files (.docx, .pptx, .xlsx): read named
 * zip parts, parse XML, and write Markdown-safe text. Office files use
 * prefixed namespaces (`w:`, `a:`, `p:`), so lookups match local names.
 */

/** Inflated size limits. A small archive can hold a huge, highly compressed
 *  part, so the on-disk file size alone does not bound memory. */
const MAX_PART_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_PART_BYTES = 256 * 1024 * 1024;

/** Reads the named parts of a zip archive as UTF-8 text. Throws when the bytes
 *  are not a zip or the selected parts would inflate past the size limits. */
export const readZipParts = (bytes: Uint8Array, wanted: (name: string) => boolean): Map<string, string> => {
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (!wanted(file.name)) return false;
      total += file.originalSize;
      if (file.originalSize > MAX_PART_BYTES || total > MAX_TOTAL_PART_BYTES) {
        throw new Error(`Document part ${file.name} is too large to read`);
      }
      return true;
    },
  });
  return new Map(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
};

/** Parses one part and returns its root element, or null when the part is missing or malformed. */
export const parseXml = (source: string | undefined): XmlElement | null => {
  if (!source) return null;
  try {
    return parseXmlElement(source);
  } catch {
    return null;
  }
};

export const children = (element: XmlElement, name?: string): XmlElement[] => (
  name ? element.children.filter((node) => node.localName === name) : element.children
);

export const child = (element: XmlElement | undefined, name: string): XmlElement | undefined => (
  element ? children(element, name)[0] : undefined
);

/** First descendant with the given local name, in document order. */
export const descendant = (element: XmlElement, name: string): XmlElement | undefined => {
  for (const node of element.children) {
    if (node.localName === name) return node;
    const found = descendant(node, name);
    if (found) return found;
  }
  return undefined;
};

/** Reads `w:val` (or another attribute) by local name. An unprefixed attribute wins. */
export const attr = (element: XmlElement | undefined, name = 'val'): string | null => {
  if (!element) return null;
  const plain = element.attributes.get(name);
  if (plain !== undefined) return plain;
  for (const [qualified, value] of element.attributes) {
    if (qualified.endsWith(`:${name}`)) return value;
  }
  return null;
};

/** Reads a relationship reference (`r:id`). Elements such as `p:sldId` also
 *  carry a plain `id`, so only a prefixed attribute counts. */
export const relationshipId = (element: XmlElement): string | null => {
  for (const [qualified, value] of element.attributes) {
    if (qualified.endsWith(':id')) return value;
  }
  return null;
};

/** A `w:b`-style toggle is on unless its value says otherwise. */
export const isOn = (element: XmlElement | undefined): boolean => {
  if (!element) return false;
  const value = attr(element);
  return value !== 'false' && value !== '0' && value !== 'none';
};

/** Escapes inline Markdown syntax and entity introducers such as `&copy;`. */
export const escapeText = (text: string): string => text.replace(/([\\`*_[\]&])/g, '\\$1');

/** Escapes text at the start of a line that Markdown would read as a block:
 *  `# heading`, `- item`, `> quote`, `1. item`, `---`, and fences. */
export const escapeLineStarts = (text: string): string => text
  .replace(/^([ \t]*)(?=#{1,6}(?:[ \t]|$)|>|[+-](?:[ \t]|$)|([=~-])\2)/gm, '$1\\')
  .replace(/^([ \t]*\d{1,9})([.)])(?=[ \t]|$)/gm, '$1\\$2');

/** Makes text safe for one Markdown table cell. */
export const tableCell = (text: string): string => (
  escapeText(text).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()
);

/** Renders rows as a Markdown table. The first row is the header. */
export const renderTable = (rows: string[][]): string => {
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (width === 0) return '';
  const line = (cells: string[]) => {
    const padded = [...cells, ...Array<string>(width - cells.length).fill('')];
    return `| ${padded.map((cell) => cell || ' ').join(' | ')} |`;
  };
  const [header, ...body] = rows;
  return [line(header), line(Array<string>(width).fill('---')), ...body.map(line)].join('\n');
};
