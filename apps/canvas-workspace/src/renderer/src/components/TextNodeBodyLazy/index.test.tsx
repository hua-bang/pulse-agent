// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../types';

vi.mock('../TextNodeBody', () => ({
  TextNodeBody: () => <div data-testid="mock-text-editor" />,
}));

import { TextNodeBodyLazy, htmlToPreviewText } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const node = {
  id: 'text-1',
  type: 'text',
  title: 'Text',
  x: 0,
  y: 0,
  width: 200,
  height: 40,
  data: { content: '<p>Hello <strong>Canvas</strong></p>' },
  updatedAt: 1,
} as CanvasNode;

const renderTextNodeBodyLazy = async (props: { isSelected?: boolean; readOnly?: boolean } = {}) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => {
    root?.render(
      <TextNodeBodyLazy
        node={node}
        onUpdate={vi.fn()}
        isSelected={props.isSelected ?? false}
        isResizing={false}
        onSelect={vi.fn()}
        onDragStart={vi.fn()}
        readOnly={props.readOnly ?? false}
      />,
    );
  });

  return host;
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('htmlToPreviewText', () => {
  it('extracts text without executing or exposing markup', () => {
    expect(htmlToPreviewText('<p>Hello <strong>Canvas</strong></p><script>alert(1)</script>'))
      .toBe('Hello Canvasalert(1)');
  });
});

describe('TextNodeBodyLazy', () => {
  it('renders the real styled editor immediately, even when unselected', async () => {
    const view = await renderTextNodeBodyLazy({ isSelected: false });

    expect(view.querySelector('[data-testid="mock-text-editor"]')).not.toBeNull();
    expect(view.querySelector('.text-node-preview')).toBeNull();
  });

  it('keeps read-only text nodes in flattened preview mode', async () => {
    const view = await renderTextNodeBodyLazy({ readOnly: true });

    expect(view.querySelector('[data-testid="mock-text-editor"]')).toBeNull();
    expect(view.querySelector('.text-node-preview')).not.toBeNull();
  });
});
