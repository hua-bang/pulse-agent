// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { renderMarkdown } from '../../../../chat/components/utils/markdown';

// Read and edit states of a note must share one set of document styles. The
// passive preview renders Markdown through the note variant inside the same
// `.note-tiptap-editor .ProseMirror` shell as Tiptap; these fixtures mirror
// both DOMs under every host stylesheet that has touched them.
const css = (path: string) => readFileSync(`src/renderer/src/modules/${path}`, 'utf8');
const documentCss = [
  css('canvas/components/node-bodies/FileNodeBody/index.css'),
  css('canvas/components/node-bodies/FileNodeBodyLazy/index.css'),
  css('workspace-nodes/internal/NodeCanvasPreview/index.css'),
  css('workspace-nodes/internal/NodeDetailDocument.css'),
];
// Chat styles load lazily, so a preview must not change when they arrive.
const chatCss = [
  css('chat/components/ChatMessage/MarkdownContent/index.css'),
  css('chat/components/ChatMessages/index.css'),
];

const source = '# Title\n\nBody with `code` and **bold**.\n\n- item\n\n#### Fourth\n\n> quote\n\n```ts\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n| one | two |';
const editorHtml = '<h1>Title</h1><p>Body with <code>code</code> and <strong>bold</strong>.</p>'
  + '<ul><li><p>item</p></li></ul><h4>Fourth</h4><blockquote><p>quote</p></blockquote>'
  + '<pre><code class="language-ts">const x = 1;</code></pre>'
  + '<table class="note-table"><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr>'
  + '<tr><td><p>one</p></td><td><p>two</p></td></tr></tbody></table>';

const hosts = [
  'canvas-node',
  'node-detail-panel node-detail-panel--dock',
  'node-detail-panel node-detail-panel--dock node-detail-panel--document-dock',
];
// White-space is left out: in the app ProseMirror's injected base sheet gives
// the editor pre-wrap, which the preview matches for code only (see index.css).
const properties = [
  'fontSize', 'lineHeight', 'fontWeight', 'color',
  'marginTop', 'marginBottom', 'paddingTop', 'paddingLeft', 'backgroundColor',
] as const;
const probes = ['h1', 'p', 'li', 'h4', 'blockquote', 'pre', 'p code', 'table', 'td'];

const styles: HTMLStyleElement[] = [];
let fixture: HTMLDivElement | undefined;
afterEach(() => { styles.splice(0).forEach((style) => style.remove()); fixture?.remove(); });

const mount = (sheets: string[], host: string) => {
  for (const text of sheets) {
    const style = document.createElement('style');
    style.textContent = text;
    document.head.appendChild(style);
    styles.push(style);
  }
  const shell = (cardClass: string, body: string) => (
    `<div class="${host}"><div class="node-canvas-preview"><div class="${cardClass}">`
    + `<div class="note-tiptap-editor"><div class="ProseMirror">${body}</div></div>`
    + '</div></div></div>'
  );
  fixture = document.createElement('div');
  fixture.innerHTML = shell(
    'note-card file-preview',
    `<div class="note-markdown-preview">${renderMarkdown(source, { softBreaks: false, variant: 'note' })}</div>`,
  ) + shell('note-card', editorHtml);
  document.body.appendChild(fixture);
  const [preview, editor] = Array.from(fixture.querySelectorAll<HTMLElement>('.note-card'));
  return { preview, editor };
};

const snapshot = (card: HTMLElement) => Object.fromEntries(probes.map((probe) => {
  const element = card.querySelector<HTMLElement>(`.ProseMirror ${probe}`);
  expect(element, probe).not.toBeNull();
  const style = getComputedStyle(element!);
  return [probe, Object.fromEntries(properties.map((name) => [name, style[name]]))];
}));

it.each([
  ['without chat styles', documentCss],
  ['with chat styles loaded first', [...chatCss, ...documentCss]],
  ['with chat styles loaded last', [...documentCss, ...chatCss]],
])('renders preview blocks with the editor document styles %s', (_name, sheets) => {
  for (const host of hosts) {
    const { preview, editor } = mount(sheets, host);
    expect(snapshot(preview), host).toEqual(snapshot(editor));
    styles.splice(0).forEach((style) => style.remove());
    fixture?.remove();
  }
});

it.each(hosts)('keeps document insets on the shared ProseMirror shell in %s', (host) => {
  const { preview, editor } = mount([...chatCss, ...documentCss], host);
  for (const side of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) {
    expect(getComputedStyle(preview)[side]).toBe(getComputedStyle(editor)[side]);
    expect(getComputedStyle(preview.querySelector('.ProseMirror')!)[side])
      .toBe(getComputedStyle(editor.querySelector('.ProseMirror')!)[side]);
  }
});

it('keeps the code copy action out of block layout', () => {
  const { preview } = mount([...chatCss, ...documentCss], hosts[0]);
  const copy = preview.querySelector<HTMLElement>('.note-code-block-copy')!;
  expect(getComputedStyle(copy).position).toBe('absolute');
  expect(getComputedStyle(preview.querySelector('.note-code-block')!).position).toBe('relative');
});
