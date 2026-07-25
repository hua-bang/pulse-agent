// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { FileNodeBubbleMenu } from '.';

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
});

describe('FileNodeBubbleMenu', () => {
  it('formats the selection and changes its block type from the shared command registry', async () => {
    host = document.createElement('div');
    document.body.append(host);
    editorHost = document.createElement('div');
    document.body.append(editorHost);
    editor = new Editor({
      element: editorHost,
      extensions: [
        StarterKit.configure({ underline: false }),
        Underline,
        Highlight,
      ],
      content: '<p>Alpha</p>',
    });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.view.focus();

    root = createRoot(host);
    act(() => root?.render(
      <I18nProvider>
        <FileNodeBubbleMenu
          editor={editor!}
          bubble={{ x: 120, y: 80, bottom: 100 }}
          onOpenLinkPrompt={vi.fn()}
        />
      </I18nProvider>,
    ));

    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Bold"]')?.click());
    expect(editor.isActive('bold')).toBe(true);

    const typeButton = document.querySelector<HTMLButtonElement>('[aria-label="Turn into"]');
    act(() => {
      typeButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      typeButton?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      typeButton?.click();
    });
    expect(editor.isFocused).toBe(true);
    const heading = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ).find((button) => button.textContent?.includes('Heading 1'));
    let mouseDownWasPrevented = false;
    act(() => {
      mouseDownWasPrevented = !heading!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );
      heading?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      heading?.click();
    });
    expect(mouseDownWasPrevented).toBe(true);
    expect(editor.isActive('heading', { level: 1 })).toBe(true);

    act(() => typeButton?.click());
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })));
    expect(document.activeElement?.getAttribute('role')).toBe('menuitemradio');
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(editor.isFocused).toBe(true);
    expect(document.activeElement).toBe(editor.view.dom);
    expect(document.querySelector('.note-bubble-type-menu')).toBeNull();
  });
});
