import { Node, mergeAttributes } from '@tiptap/react';

export const CALLOUT_DEFAULT_ICON = '💡';

const CALLOUT_MARKER_RE = /^\[!([^\]\n]+)\]$/;

/**
 * Rewrite `> [!icon]` alert blockquotes produced by markdown-it back into
 * `div[data-callout]` so they parse as callout nodes. Best-effort: a blockquote
 * that doesn't match is left untouched, and content is never dropped — a parse
 * miss simply degrades a callout to a normal blockquote.
 */
const upgradeCalloutBlockquotes = (element: HTMLElement) => {
  const doc = element.ownerDocument;
  for (const bq of Array.from(element.querySelectorAll('blockquote'))) {
    const first = bq.firstElementChild;
    if (!first || first.tagName !== 'P') continue;
    const marker = (first.textContent ?? '').trim().match(CALLOUT_MARKER_RE);
    if (!marker) continue;

    const div = doc.createElement('div');
    div.setAttribute('data-callout', marker[1]);
    first.remove();
    while (bq.firstChild) div.appendChild(bq.firstChild);
    if (!div.firstChild) div.appendChild(doc.createElement('p'));
    bq.replaceWith(div);
  }
};

/**
 * Notion-style callout: a block container with an emoji icon and rich content.
 * Serializes to a GitHub alert blockquote that round-trips through markdown:
 *
 *   > [!💡]
 *   >
 *   > body…
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      icon: {
        default: CALLOUT_DEFAULT_ICON,
        parseHTML: (el) => el.getAttribute('data-callout') || CALLOUT_DEFAULT_ICON,
        renderHTML: (attrs) => ({ 'data-callout': attrs.icon || CALLOUT_DEFAULT_ICON }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'note-callout' }), 0];
  },

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const icon = String(node.attrs.icon || CALLOUT_DEFAULT_ICON);
          state.write(`> [!${icon}]`);
          state.ensureNewLine();
          state.write('>');
          state.ensureNewLine();
          state.wrapBlock('> ', null, node, () => state.renderContent(node));
        },
        parse: {
          updateDOM(element: HTMLElement) {
            upgradeCalloutBlockquotes(element);
          },
        },
      },
    };
  },
});
