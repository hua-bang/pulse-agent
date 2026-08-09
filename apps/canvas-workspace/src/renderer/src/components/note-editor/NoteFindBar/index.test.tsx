// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteSearchExtension, setNoteSearch } from '../../../editor/noteSearchExtension';
import { I18nProvider } from '../../../i18n';
import { NoteFindBar } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editorHost: HTMLDivElement | null = null;
let editor: Editor | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  editor?.destroy();
  host?.remove();
  editorHost?.remove();
  root = null;
  host = null;
  editorHost = null;
  editor = null;
  vi.restoreAllMocks();
});

describe('NoteFindBar keyboard and accessibility', () => {
  it('keeps Cmd/Ctrl+F inside the editor and restores editor focus on Escape', () => {
    host = document.createElement('div');
    editorHost = document.createElement('div');
    document.body.append(host, editorHost);
    editor = new Editor({
      element: editorHost,
      extensions: [StarterKit, NoteSearchExtension],
      content: '<p>Find this text</p>',
    });
    const onClose = vi.fn();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    root = createRoot(host);

    act(() => {
      root?.render(
        <I18nProvider>
          <NoteFindBar editor={editor!} onClose={onClose} />
        </I18nProvider>,
      );
    });

    const search = host.querySelector('[role="search"]');
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Find"]');
    expect(search?.getAttribute('aria-label')).toBe('Find in document');
    expect(document.activeElement).toBe(input);

    const repeatFind = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => input?.dispatchEvent(repeatFind));
    expect(repeatFind.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => input?.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it('updates the active match and total after search, navigation, and replacement transactions', () => {
    host = document.createElement('div');
    editorHost = document.createElement('div');
    document.body.append(host, editorHost);
    editor = new Editor({
      element: editorHost,
      extensions: [StarterKit, NoteSearchExtension],
      content: '<p>alpha alpha alpha</p>',
    });
    root = createRoot(host);

    act(() => {
      root?.render(
        <I18nProvider>
          <NoteFindBar editor={editor!} onClose={vi.fn()} />
        </I18nProvider>,
      );
    });

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Find"]');
    const count = host.querySelector<HTMLElement>('.note-find-count');
    const next = host.querySelector<HTMLButtonElement>('button[aria-label^="Next match"]');
    const previous = host.querySelector<HTMLButtonElement>('button[aria-label^="Previous match"]');
    if (!input || !count || !next || !previous) {
      throw new Error('Expected find controls');
    }

    act(() => setNoteSearch(editor!.view, 'alpha'));
    expect(count.textContent).toBe('1/3');

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'alpha');
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(count.textContent).toBe('1/3');

    act(() => next.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(count.textContent).toBe('2/3');

    act(() => previous.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(count.textContent).toBe('1/3');

    const showReplace = host.querySelector<HTMLButtonElement>('button[aria-label="Show replace"]');
    if (!showReplace) throw new Error('Expected replace toggle');
    act(() => showReplace.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const replacement = host.querySelector<HTMLInputElement>('input[aria-label="Replace"]');
    const replace = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Replace');
    const replaceAll = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Replace all');
    if (!replacement || !replace || !replaceAll) {
      throw new Error('Expected replace controls');
    }
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        replacement,
        'beta',
      );
      replacement.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });

    act(() => replace.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(editor.getText()).toBe('beta alpha alpha');
    expect(count.textContent).toBe('1/2');

    act(() => replaceAll.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(editor.getText()).toBe('beta beta beta');
    expect(count.textContent).toBe('0/0');
  });
});
