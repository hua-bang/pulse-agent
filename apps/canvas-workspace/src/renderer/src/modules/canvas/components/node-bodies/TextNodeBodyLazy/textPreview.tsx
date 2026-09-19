import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import { createElement, type CSSProperties, type ReactNode } from 'react';

const markdown = new MarkdownIt({ html: true, breaks: true, linkify: false });

const textTags = [
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
  'code', 'span', 'mark', 'a',
];
const textTagSet = new Set(textTags);
const blockContainers = new Set(['ul', 'ol', 'li', 'blockquote']);
const safeLinkProtocol = /^(?:https?:|mailto:)/i;

interface PreviewProps {
  key: string;
  href?: string;
  rel?: string;
  target?: '_blank';
  start?: number;
  style?: CSSProperties;
}

const previewStyle = (element: HTMLElement): CSSProperties | undefined => {
  if (element.localName === 'span') {
    return element.style.color ? { color: element.style.color } : undefined;
  }
  if (element.localName !== 'mark') return undefined;

  // Tiptap's multicolor highlight prioritizes data-color over the inline
  // background. Let the browser parse that value as one color property;
  // never forward arbitrary CSS declarations from the stored document.
  const colorProbe = document.createElement('span');
  colorProbe.style.backgroundColor = element.getAttribute('data-color') ?? '';
  const backgroundColor = colorProbe.style.backgroundColor || element.style.backgroundColor;
  const color = element.style.color || (backgroundColor ? 'inherit' : undefined);
  return backgroundColor || color ? { backgroundColor, color } : undefined;
};

const projectNode = (node: Node, key: string): ReactNode => {
  if (node.nodeType === Node.TEXT_NODE) {
    let text = node.textContent ?? '';
    // markdown-it emits formatting newlines between blocks and after <br>.
    // Tiptap removes those before parsing; retaining them with pre-wrap would
    // add visible blank lines and change a text node's measured size.
    if (node.previousSibling?.nodeType === Node.ELEMENT_NODE) {
      text = text.replace(/^\n/, '');
    }
    const parentTag = (node.parentNode as Element | null)?.localName;
    if ((!parentTag || blockContainers.has(parentTag)) && /^\s*$/.test(text)) {
      return null;
    }
    return text;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as HTMLElement;
  const originalTag = element.localName;
  if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !textTagSet.has(originalTag)) {
    return null;
  }
  const tag = originalTag === 'b' ? 'strong' : originalTag === 'i' ? 'em' : originalTag;
  const children = Array.from(element.childNodes, (child, index) => projectNode(child, `${key}.${index}`));
  const props: PreviewProps = { key };

  if (tag === 'a') {
    const href = element.getAttribute('href');
    if (!href || !safeLinkProtocol.test(href)) return children;
    props.href = href;
    props.rel = 'noopener noreferrer';
    props.target = '_blank';
  }
  if (tag === 'ol') {
    const start = element.getAttribute('start');
    if (start !== null && /^[-+]?\d+$/.test(start) && Number.isSafeInteger(Number(start))) {
      props.start = Number(start);
    }
  }
  props.style = previewStyle(element);
  return tag === 'br' ? createElement(tag, props) : createElement(tag, props, children);
};

/** Passive Text-node content without constructing an editor or attaching HTML. */
export const renderTextPreview = (content: string): ReactNode => {
  if (!content) return null;
  const fragment = DOMPurify.sanitize(markdown.render(content), {
    ALLOWED_TAGS: textTags,
    ALLOWED_ATTR: ['href', 'start', 'style', 'data-color'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: safeLinkProtocol,
    ADD_URI_SAFE_ATTR: ['start', 'data-color'],
    ADD_FORBID_CONTENTS: ['form', 'object', 'button', 'textarea', 'select', 'option'],
    RETURN_DOM_FRAGMENT: true,
  });
  // DOMPurify owns HTML sanitization. The projection keeps only the editor's
  // supported visual attributes; no sanitized or original HTML is injected.
  return Array.from(fragment.childNodes, (node, index) => projectNode(node, String(index)));
};
