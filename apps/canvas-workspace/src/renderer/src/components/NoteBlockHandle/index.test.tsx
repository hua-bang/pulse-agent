// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n';
import { NoteBlockHandle } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editor: Editor | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  editor?.destroy();
  host?.remove();
  root = null;
  host = null;
  editor = null;
});

describe('NoteBlockHandle', () => {
  it('reveals a handle for the hovered block and opens actions for that block', () => {
    const card = document.createElement('div');
    const editorHost = document.createElement('div');
    host = document.createElement('div');
    card.append(editorHost, host);
    document.body.append(card);
    const cardRef = { current: card };
    editor = new Editor({ element: editorHost, extensions: [StarterKit], content: '<h1>Alpha</h1><p>Beta</p>' });
    Object.defineProperty(card, 'getBoundingClientRect', { value: () => ({ top: 10, left: 0, right: 300, bottom: 300, width: 300, height: 290 }) });
    const firstBlock = editor.view.dom.children[0] as HTMLElement;
    Object.defineProperty(firstBlock, 'getBoundingClientRect', { value: () => ({ top: 40, left: 30, right: 280, bottom: 70, width: 250, height: 30 }) });

    root = createRoot(host);
    act(() => root?.render(<I18nProvider><NoteBlockHandle editor={editor!} cardRef={cardRef} /></I18nProvider>));
    act(() => firstBlock.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })));

    const handle = document.querySelector<HTMLButtonElement>('.note-block-handle');
    expect(handle).not.toBeNull();
    expect(handle?.closest<HTMLElement>('.note-block-handle-anchor')?.style.top).toBe('30px');
    act(() => handle?.click());
    expect(document.querySelector('.note-block-menu')?.textContent).toContain('Duplicate block');
    act(() => editor?.view.dom.parentElement?.dispatchEvent(new Event('scroll')));
    expect(document.querySelector('.note-block-handle')).toBeNull();
    expect(document.querySelector('.note-block-menu')).toBeNull();
  });
});
