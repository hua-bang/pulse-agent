/**
 * A small XML reader for Office Open XML parts.
 *
 * Office files are well-formed XML with namespace prefixes on both elements
 * and attributes (`<p:sldId id="256" r:id="rId2"/>`). A DOM implementation
 * that keys attributes by local name loses one of `id` and `r:id`, so this
 * reader keeps every attribute under its qualified name. It supports
 * elements, attributes, text, CDATA, and the predefined and numeric
 * entities; it skips declarations, comments, and processing instructions,
 * and it never expands custom entities.
 */

export class XmlElement {
  readonly children: XmlElement[] = [];
  /** Direct text of this element, in order, without its children's text. */
  text = '';

  constructor(
    /** Qualified name, for example `w:p`. */
    readonly name: string,
    /** Attributes by qualified name, for example `r:id`. */
    readonly attributes: ReadonlyMap<string, string>,
  ) {}

  /** Name without the namespace prefix, for example `p` for `w:p`. */
  get localName(): string {
    const colon = this.name.indexOf(':');
    return colon < 0 ? this.name : this.name.slice(colon + 1);
  }

  /** Text of this element and all its descendants. */
  get textContent(): string {
    return this.text + this.children.map((node) => node.textContent).join('');
  }
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const decodeEntities = (text: string): string => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
  if (entity[0] === '#') {
    const code = entity[1] === 'x' || entity[1] === 'X'
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }
  return ENTITIES[entity] ?? match;
});

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const TAG_NAME = /^[^\s/>]+/;

/** Parses an XML string and returns its root element. Throws on malformed XML. */
export const parseXmlElement = (source: string): XmlElement => {
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let index = 0;

  const appendText = (raw: string) => {
    const current = stack[stack.length - 1];
    if (current) current.text += raw;
  };

  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open < 0) {
      appendText(decodeEntities(source.slice(index)));
      break;
    }
    if (open > index) appendText(decodeEntities(source.slice(index, open)));

    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open);
      if (end < 0) throw new Error('Unclosed CDATA section');
      appendText(source.slice(open + 9, end));
      index = end + 3;
      continue;
    }
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open);
      if (end < 0) throw new Error('Unclosed comment');
      index = end + 3;
      continue;
    }
    const close = source.indexOf('>', open);
    if (close < 0) throw new Error('Unclosed tag');
    const tag = source.slice(open + 1, close);
    index = close + 1;

    // Declarations (`<?xml …?>`, `<!DOCTYPE …>`) carry nothing we read.
    if (tag.startsWith('?') || tag.startsWith('!')) continue;

    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      const element = stack.pop();
      if (!element || element.name !== name) throw new Error(`Unexpected closing tag </${name}>`);
      continue;
    }

    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const name = TAG_NAME.exec(body)?.[0];
    if (!name) throw new Error('Missing tag name');
    const attributes = new Map<string, string>();
    for (const match of body.slice(name.length).matchAll(ATTRIBUTE)) {
      attributes.set(match[1], decodeEntities(match[2] ?? match[3] ?? ''));
    }
    const element = new XmlElement(name, attributes);
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(element);
    else if (root) throw new Error('More than one root element');
    else root = element;
    if (!selfClosing) stack.push(element);
  }

  if (!root) throw new Error('No root element');
  if (stack.length > 0) throw new Error(`Unclosed element <${stack[stack.length - 1].name}>`);
  return root;
};
