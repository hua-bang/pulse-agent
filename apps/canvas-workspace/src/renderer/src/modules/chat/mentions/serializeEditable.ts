// Block-level elements the browser inserts to represent line breaks in a
// contentEditable. Chromium wraps each line of pasted multi-line text (and
// each paragraph created by Enter) in a <div>; without treating these as line
// boundaries, serialization concatenates their text with no separator and
// silently drops the newlines — collapsing pasted code/JSON into one line.
const BLOCK_LINE_TAGS = new Set([
  'DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'SECTION', 'ARTICLE',
]);

/**
 * Serialize a composer's contentEditable subtree back to plain text: mention
 * chips become their `@[...]` markers, and block boundaries / <br>s become
 * newlines so pasted multi-line content keeps its formatting.
 */
export function serializeEditable(element: HTMLElement): string {
  let text = '';

  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? '';
      continue;
    }

    if (!(child instanceof HTMLElement)) {
      continue;
    }

    if (child.dataset.mention) {
      text += `@[${child.dataset.mention}]`;
      continue;
    }

    if (child.tagName === 'BR') {
      text += '\n';
      continue;
    }

    // Start a block-level child on its own line (unless we're already at the
    // start of the output or a newline) so pasted line breaks survive.
    if (BLOCK_LINE_TAGS.has(child.tagName) && text.length > 0 && !text.endsWith('\n')) {
      text += '\n';
    }

    text += serializeEditable(child);
  }

  return text;
}
