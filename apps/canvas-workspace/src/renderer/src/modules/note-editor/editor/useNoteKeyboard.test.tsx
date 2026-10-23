// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileNodeData } from '../../../types';
import { useNoteKeyboard } from './useNoteKeyboard';

const { duplicateCurrentNoteBlock } = vi.hoisted(() => ({ duplicateCurrentNoteBlock: vi.fn() }));
vi.mock('../runtime/noteBlockCommands', () => ({
  duplicateCurrentNoteBlock,
  moveCurrentNoteBlock: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('useNoteKeyboard', () => {
  it('keeps focused-note Ctrl/Cmd+F search available without a visible toolbar', () => {
    const onOpenFind = vi.fn();
    const editor = { isFocused: true } as Editor;
    const Harness = () => {
      useNoteKeyboard({
        editor,
        readOnly: false,
        dataRef: { current: { content: '' } as FileNodeData },
        persistToFile: vi.fn(),
        getMarkdown: vi.fn(() => ''),
        onOpenFind,
      });
      return null;
    };

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onOpenFind).toHaveBeenCalledTimes(1);
  });

  it('leaves composition shortcuts to the IME', () => {
    const onOpenFind = vi.fn();
    const editor = { isFocused: true } as Editor;
    const Harness = () => {
      useNoteKeyboard({
        editor,
        readOnly: false,
        dataRef: { current: { content: '' } as FileNodeData },
        persistToFile: vi.fn(),
        getMarkdown: vi.fn(() => ''),
        onOpenFind,
      });
      return null;
    };

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(onOpenFind).not.toHaveBeenCalled();
  });

  it('claims Ctrl/Cmd+Shift+D before app-level shortcuts such as the theme toggle', () => {
    const editor = { isFocused: true } as Editor;
    const appListener = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
    window.addEventListener('keydown', appListener);
    const Harness = () => {
      useNoteKeyboard({
        editor,
        readOnly: false,
        dataRef: { current: { content: '' } as FileNodeData },
        persistToFile: vi.fn(),
        getMarkdown: vi.fn(() => ''),
        onOpenFind: vi.fn(),
      });
      return null;
    };

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    const event = new KeyboardEvent('keydown', {
      key: 'D',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(event));
    window.removeEventListener('keydown', appListener);

    expect(duplicateCurrentNoteBlock).toHaveBeenCalledTimes(1);
    expect(appListener).toHaveReturnedWith(true);
  });
});
