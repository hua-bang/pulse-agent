// @vitest-environment happy-dom
import { act, useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerHistoryRecall } from '../useComposerHistoryRecall';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let handle: ((event: ReactKeyboardEvent) => boolean) | null = null;
let history: string[] = [];

const placeCaret = (element: HTMLElement, atEnd: boolean) => {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(!atEnd);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const Probe = () => {
  const editableRef = useRef<HTMLDivElement>(null);
  const replaceInput = useCallback((text: string) => {
    const element = editableRef.current;
    if (!element) return;
    element.textContent = text;
    placeCaret(element, true);
  }, []);
  handle = useComposerHistoryRecall({
    editableRef,
    getUserMessages: () => history,
    replaceInput,
  });
  return <div ref={editableRef} contentEditable />;
};

const editable = (): HTMLDivElement => {
  const element = host?.querySelector<HTMLDivElement>('[contenteditable]');
  if (!element) throw new Error('editable did not mount');
  return element;
};

const press = (key: string, modifiers: Partial<ReactKeyboardEvent> = {}) => {
  const preventDefault = vi.fn();
  const handled = handle?.({
    key,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    preventDefault,
    ...modifiers,
  } as unknown as ReactKeyboardEvent) ?? false;
  return { handled, prevented: preventDefault.mock.calls.length > 0 };
};

const mount = async (messages: string[]) => {
  history = messages;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<Probe />));
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  handle = null;
  history = [];
});

describe('composer ArrowUp/ArrowDown history recall', () => {
  it('walks back through user messages from an empty composer and forward to empty', async () => {
    await mount(['first', 'second', 'third']);

    expect(press('ArrowUp')).toEqual({ handled: true, prevented: true });
    expect(editable().textContent).toBe('third');
    press('ArrowUp');
    expect(editable().textContent).toBe('second');
    press('ArrowUp');
    expect(editable().textContent).toBe('first');
    // At the oldest message the key is swallowed and the text stays.
    expect(press('ArrowUp')).toEqual({ handled: true, prevented: true });
    expect(editable().textContent).toBe('first');

    press('ArrowDown');
    expect(editable().textContent).toBe('second');
    press('ArrowDown');
    expect(editable().textContent).toBe('third');
    press('ArrowDown');
    expect(editable().textContent).toBe('');
    // Back at the empty draft, ArrowDown is an ordinary key again.
    expect(press('ArrowDown')).toEqual({ handled: false, prevented: false });
  });

  it('leaves ArrowUp alone when the draft has text', async () => {
    await mount(['first']);
    editable().textContent = 'typing';
    placeCaret(editable(), true);
    expect(press('ArrowUp')).toEqual({ handled: false, prevented: false });
    expect(editable().textContent).toBe('typing');
  });

  it('stops recalling once the recalled text is edited', async () => {
    await mount(['first', 'second']);
    press('ArrowUp');
    editable().textContent = 'second, edited';
    placeCaret(editable(), true);
    expect(press('ArrowUp')).toEqual({ handled: false, prevented: false });
    expect(press('ArrowDown')).toEqual({ handled: false, prevented: false });
    expect(editable().textContent).toBe('second, edited');
  });

  it('keeps line navigation inside a recalled multi-line message', async () => {
    await mount(['older', 'line one\nline two']);
    press('ArrowUp');
    expect(editable().textContent).toBe('line one\nline two');
    // Caret at the end, on the second line: ArrowUp moves the caret.
    expect(press('ArrowUp')).toEqual({ handled: false, prevented: false });
    placeCaret(editable(), false);
    expect(press('ArrowUp').handled).toBe(true);
    expect(editable().textContent).toBe('older');
  });

  it('ignores modified arrows and an empty history', async () => {
    await mount([]);
    expect(press('ArrowUp')).toEqual({ handled: false, prevented: false });
    history = ['first'];
    expect(press('ArrowUp', { shiftKey: true }).handled).toBe(false);
    expect(press('ArrowUp', { metaKey: true }).handled).toBe(false);
  });
});
