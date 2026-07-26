// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCanvasMotion } from '../../hooks/canvasMotion';
import { I18nProvider } from '../../i18n';
import { TextColorMark } from '../TextNodeBody/textColorMark';
import { FileNodeBubbleMenu } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editorHost: HTMLDivElement | null = null;
let editor: Editor | null = null;

afterEach(() => {
  setCanvasMotion('idle', false);
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
  it('owns Escape and wheel events while the selection toolbar is open', () => {
    host = document.createElement('div');
    document.body.append(host);
    editorHost = document.createElement('div');
    document.body.append(editorHost);
    editor = new Editor({
      element: editorHost,
      extensions: [
        StarterKit.configure({ underline: false }),
        Underline,
        TextColorMark,
        Highlight.configure({ multicolor: true }),
      ],
      content: '<p>Alpha</p>',
    });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.view.focus();
    const onClose = vi.fn();
    const onCanvasWheel = vi.fn();
    const onCanvasEscape = vi.fn();
    window.addEventListener('keydown', onCanvasEscape);

    root = createRoot(host);
    act(() => root?.render(
      <I18nProvider>
        <div onWheel={onCanvasWheel}>
          <FileNodeBubbleMenu
            editor={editor!}
            bubble={{ x: 120, y: 80, bottom: 100 }}
            onOpenLinkPrompt={vi.fn()}
            onClose={onClose}
          />
        </div>
      </I18nProvider>,
    ));

    const toolbar = document.querySelector<HTMLElement>('.note-bubble-menu');
    act(() => {
      toolbar?.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: 24,
      }));
    });
    expect(onCanvasWheel).not.toHaveBeenCalled();

    act(() => {
      editor?.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCanvasEscape).not.toHaveBeenCalled();

    window.removeEventListener('keydown', onCanvasEscape);
  });

  it('applies text and highlight colors to the selection', () => {
    host = document.createElement('div');
    document.body.append(host);
    editorHost = document.createElement('div');
    document.body.append(editorHost);
    editor = new Editor({
      element: editorHost,
      extensions: [
        StarterKit.configure({ underline: false }),
        Underline,
        TextColorMark,
        Highlight.configure({ multicolor: true }),
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
          onClose={vi.fn()}
        />
      </I18nProvider>,
    ));

    const colorButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Inline formatting"]',
    );
    act(() => colorButton?.click());
    const redText = document.querySelector<HTMLButtonElement>(
      '[aria-label="Use Red on selected text"]',
    );
    const blueHighlight = document.querySelector<HTMLButtonElement>(
      '[aria-label="Use Blue highlight on selected text"]',
    );
    expect(redText).not.toBeNull();
    expect(blueHighlight).not.toBeNull();
    expect(redText?.getAttribute('role')).toBe('menuitemradio');
    expect(blueHighlight?.getAttribute('role')).toBe('menuitemradio');

    act(() => redText?.click());
    expect(editor.isActive('textColor', { color: '#e03131' })).toBe(true);
    expect(redText?.getAttribute('aria-checked')).toBe('true');

    act(() => blueHighlight?.click());
    expect(editor.isActive('highlight', { color: '#d0ebff' })).toBe(true);
  });

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
    const onClose = vi.fn();

    root = createRoot(host);
    act(() => root?.render(
      <I18nProvider>
        <FileNodeBubbleMenu
          editor={editor!}
          bubble={{ x: 120, y: 80, bottom: 100 }}
          onOpenLinkPrompt={vi.fn()}
          onClose={onClose}
        />
      </I18nProvider>,
    ));

    const boldButton = document.querySelector<HTMLButtonElement>('[aria-label="Bold"]');
    expect(boldButton?.getAttribute('aria-pressed')).toBe('false');
    act(() => boldButton?.click());
    expect(editor.isActive('bold')).toBe(true);
    expect(boldButton?.getAttribute('aria-pressed')).toBe('true');

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

    act(() => setCanvasMotion('zoom-in', false));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
