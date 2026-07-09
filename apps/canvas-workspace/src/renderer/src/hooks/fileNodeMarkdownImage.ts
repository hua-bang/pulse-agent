import Image from '@tiptap/extension-image';
import { toFileUrl } from '../utils/fileUrl';

const FILE_IMAGE_MARKDOWN_RE = /!\[([^\]]*)\]\(((?:file:\/\/|pulse-canvas:\/\/)[^\s)]+)(?:\s+"([^"]*)")?\)/g;
const LOCAL_IMAGE_HINT_RE = /\]\((?:file:\/\/|pulse-canvas:\/\/)/;

const restoreLocalImageMarkdown = (element: HTMLElement) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.textContent?.includes('![') && LOCAL_IMAGE_HINT_RE.test(node.textContent)) {
      textNodes.push(node as Text);
    }
  }

  for (const node of textNodes) {
    const text = node.textContent ?? '';
    FILE_IMAGE_MARKDOWN_RE.lastIndex = 0;
    if (!FILE_IMAGE_MARKDOWN_RE.test(text)) continue;

    FILE_IMAGE_MARKDOWN_RE.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    for (const match of text.matchAll(FILE_IMAGE_MARKDOWN_RE)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        fragment.append(document.createTextNode(text.slice(lastIndex, index)));
      }

      const img = document.createElement('img');
      img.setAttribute('src', toFileUrl(match[2] ?? ''));
      img.setAttribute('alt', match[1] ?? '');
      if (match[3]) img.setAttribute('title', match[3]);
      fragment.append(img);
      lastIndex = index + match[0].length;
    }
    if (lastIndex < text.length) {
      fragment.append(document.createTextNode(text.slice(lastIndex)));
    }
    node.replaceWith(fragment);
  }
};

export const MarkdownSafeImage = Image.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const src = String(node.attrs.src ?? '').replace(/[()]/g, '\\$&');
          const alt = state.esc(String(node.attrs.alt ?? ''));
          const title = node.attrs.title
            ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"`
            : '';
          state.write(`![${alt}](${src}${title})`);
        },
        parse: {
          // markdown-it rejects local image URLs by default, but file nodes
          // intentionally persist pasted local images as custom-scheme URLs.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setup(markdownit: any) {
            const originalValidateLink = markdownit.validateLink.bind(markdownit);
            markdownit.validateLink = (url: string) => {
              if (/^(file|pulse-canvas):\/\//i.test(url)) return true;
              return originalValidateLink(url);
            };
          },
          updateDOM(element: HTMLElement) {
            restoreLocalImageMarkdown(element);
          },
        },
      },
    };
  },
});
