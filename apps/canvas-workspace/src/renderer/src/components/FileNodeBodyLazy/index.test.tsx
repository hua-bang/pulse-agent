// @vitest-environment happy-dom
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../types';

vi.mock('../RightDock', () => ({
  useRightDock: () => ({ openLink: vi.fn() }),
}));

vi.mock('../FileNodeBody', () => ({
  FileNodeBody: () => <div data-testid="mock-file-editor" />,
}));

import { FileNodeBodyLazy, MarkdownPreview } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const node = {
  id: 'note-1',
  type: 'file',
  title: 'Note',
  x: 0,
  y: 0,
  width: 320,
  height: 240,
  data: { content: '# Heading' },
  updatedAt: 1,
} as CanvasNode;

const renderFileNodeBodyLazy = async (readOnly = false) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => {
    root?.render(<FileNodeBodyLazy node={node} onUpdate={vi.fn()} readOnly={readOnly} />);
  });

  return host;
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('MarkdownPreview', () => {
  it('renders common Markdown structures without injecting raw HTML', () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview content={'# Heading\n- [x] done\n`code`\n<script>alert(1)</script>'} />,
    );

    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('☑ done');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders links as escaped React elements', () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview content={'[site](https://example.com?a=1&b=2)'} />,
    );

    expect(html).toContain('href="https://example.com?a=1&amp;b=2"');
    expect(html).toContain('>site</a>');
  });

  it('uses block spacing instead of extra break elements for Markdown blank lines', () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview content={'## First\n\nParagraph\n\n## Second'} />,
    );

    expect(html).not.toContain('<br');
    expect(html).toContain('<h2>First</h2><p>Paragraph</p><h2>Second</h2>');
  });
});

describe('FileNodeBodyLazy', () => {
  it('opens writable notes in the editor by default', async () => {
    const view = await renderFileNodeBodyLazy(false);

    expect(view.querySelector('[data-testid="mock-file-editor"]')).not.toBeNull();
    expect(view.querySelector('.file-preview')).toBeNull();
  });

  it('keeps read-only notes in preview mode', async () => {
    const view = await renderFileNodeBodyLazy(true);

    expect(view.querySelector('[data-testid="mock-file-editor"]')).toBeNull();
    expect(view.querySelector('.file-preview')).not.toBeNull();
  });
});
