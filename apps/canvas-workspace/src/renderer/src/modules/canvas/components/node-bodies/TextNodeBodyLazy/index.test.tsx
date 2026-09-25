// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../../types';
import { I18nProvider } from '../../../../../i18n';

vi.mock('../TextNodeBody', () => ({
  TextNodeBody: ({ startEditing, node }: { startEditing?: boolean; node: CanvasNode }) => (
    <div data-testid="mock-text-editor" data-editing={String(startEditing)}>{'content' in node.data ? node.data.content : ''}</div>
  ),
}));

import { TextNodeBodyLazy } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
let onUpdate: ReturnType<typeof vi.fn>;
let onSelect: ReturnType<typeof vi.fn>;
let onDragStart: ReturnType<typeof vi.fn>;

const node = {
  id: 'text-1', type: 'text', title: 'Text', x: 0, y: 0, width: 200, height: 40, updatedAt: 1,
  data: { content: '<p>Hello <strong>Canvas</strong></p>', textColor: '', backgroundColor: '' },
} satisfies CanvasNode;

const renderNode = async (props: Partial<{
  node: CanvasNode; isSelected: boolean; readOnly: boolean; isResizing: boolean; editRequest: number;
}> = {}) => {
  await act(async () => {
    root?.render(
      <I18nProvider><TextNodeBodyLazy
        node={props.node ?? node}
        onUpdate={onUpdate}
        isSelected={props.isSelected ?? false}
        isResizing={props.isResizing ?? false}
        editRequest={props.editRequest}
        onSelect={onSelect}
        onDragStart={onDragStart}
        readOnly={props.readOnly ?? false}
      /></I18nProvider>,
    );
  });
};

beforeEach(() => {
  onUpdate = vi.fn();
  onSelect = vi.fn();
  onDragStart = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
});

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  root = null;
  vi.restoreAllMocks();
});

const editor = () => host.querySelector('[data-testid="mock-text-editor"]');
const body = () => host.querySelector('.text-node-body')!;

it('renders formatted idle text without creating an editor or writing content', async () => {
  await renderNode();
  expect(editor()).toBeNull();
  expect(host.querySelector('strong')?.textContent).toBe('Canvas');
  expect(onUpdate).not.toHaveBeenCalled();
  await renderNode({ isSelected: true });
  expect(editor()).toBeNull();
  act(() => body().dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(onSelect).toHaveBeenCalledWith(node.id);
  expect(onDragStart).toHaveBeenCalledOnce();
  expect(editor()).toBeNull();
});

it('preserves all content when the double-click gesture loads the editor', async () => {
  await renderNode({ isSelected: true });
  await act(async () => { body().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(editor()?.getAttribute('data-editing')).toBe('true');
  expect(editor()?.textContent).toBe(node.data.content);
  expect(onUpdate).not.toHaveBeenCalled();
  await renderNode();
  expect(editor()).not.toBeNull();
});

it('starts editing when the Canvas shortcut owner targets this node', async () => {
  await renderNode({ isSelected: true });
  expect(editor()).toBeNull();
  await renderNode({ isSelected: true, editRequest: 1 });
  expect(editor()?.getAttribute('data-editing')).toBe('true');
  expect(onUpdate).not.toHaveBeenCalled();
});

it('ignores edit signals on read-only or unselected nodes', async () => {
  await renderNode({ readOnly: true, isSelected: true, editRequest: 1 });
  expect(editor()).toBeNull();
  await renderNode({ isSelected: false, editRequest: 2 });
  expect(editor()).toBeNull();
});

it('starts a newly created selected empty node in editing mode', async () => {
  await renderNode({ isSelected: true, node: { ...node, data: { ...node.data, content: '' } } });
  expect(editor()?.getAttribute('data-editing')).toBe('true');
});

it('keeps rich read-only content and never begins editing or updates its geometry', async () => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(450);
  await renderNode({ readOnly: true, isSelected: true });
  expect(host.querySelector('strong')?.textContent).toBe('Canvas');
  await act(async () => {
    body().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  });
  expect(editor()).toBeNull();
  expect(onUpdate).not.toHaveBeenCalled();
});

it('keeps auto-size and fixed-width wrapping measurements without mounting an editor', async () => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(260);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(70);
  await renderNode();
  expect(onUpdate).toHaveBeenLastCalledWith(node.id, { width: 260, height: 70 });
  onUpdate.mockClear();
  await renderNode({ node: { ...node, data: { ...node.data, autoSize: false } } });
  expect(onUpdate).toHaveBeenLastCalledWith(node.id, { height: 70 });
  onUpdate.mockClear();
  await renderNode({ isResizing: true });
  expect(onUpdate).not.toHaveBeenCalled();
  expect(editor()).toBeNull();
});

it('reflects external and undo content changes in the idle preview', async () => {
  await renderNode();
  await renderNode({ node: { ...node, data: { ...node.data, content: '<h2>Changed</h2>' } } });
  expect(host.querySelector('h2')?.textContent).toBe('Changed');
  expect(editor()).toBeNull();
  expect(onUpdate).not.toHaveBeenCalled();
});

it('retains the existing popup link policy instead of navigating the renderer itself', async () => {
  await renderNode({ node: { ...node, data: { ...node.data, content: '<p><a href="https://example.com">Link</a></p>' } } });
  const link = host.querySelector('a')!;
  expect(link.getAttribute('href')).toBe('https://example.com');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(editor()).toBeNull();
});
