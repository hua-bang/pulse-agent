// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../../types';
import { I18nProvider } from '../../../../../i18n';
import { TextNodeBody } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let onUpdate: ReturnType<typeof vi.fn>;
const node: CanvasNode = {
  id: 'text', type: 'text', title: 'Text', x: 0, y: 0, width: 200, height: 40, updatedAt: 1,
  data: { content: '**Existing** markdown', textColor: '', backgroundColor: '' },
};

beforeEach(() => {
  vi.useFakeTimers();
  onUpdate = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('does not normalize saved content into a write when a lazy edit gesture enables Tiptap', async () => {
  await act(async () => {
    root.render(<I18nProvider><TextNodeBody
      node={node}
      onUpdate={onUpdate}
      isSelected
      isResizing={false}
      onSelect={vi.fn()}
      onDragStart={vi.fn()}
      startEditing
    /></I18nProvider>);
  });
  expect(host.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('true');
  expect(host.querySelector('.ProseMirror strong')?.textContent).toBe('Existing');
  expect(onUpdate).not.toHaveBeenCalled();
});

it('records typing as one canvas history step when editing ends', async () => {
  const renderBody = (isSelected: boolean) => root.render(<I18nProvider><TextNodeBody
    node={node}
    onUpdate={onUpdate}
    isSelected={isSelected}
    isResizing={false}
    onSelect={vi.fn()}
    onDragStart={vi.fn()}
    startEditing
  /></I18nProvider>);
  await act(async () => renderBody(true));
  const dom = host.querySelector('.ProseMirror') as HTMLElement & {
    editor: { commands: { insertContent: (text: string) => void } };
  };
  act(() => {
    dom.editor.commands.insertContent('a');
    dom.editor.commands.insertContent('b');
  });
  expect(onUpdate).toHaveBeenCalledTimes(2);
  expect(onUpdate.mock.calls.every((call) => call[2]?.history === false)).toBe(true);

  await act(async () => renderBody(false));
  expect(onUpdate).toHaveBeenCalledTimes(3);
  expect(onUpdate.mock.calls[2][2]).toBeUndefined();
});
