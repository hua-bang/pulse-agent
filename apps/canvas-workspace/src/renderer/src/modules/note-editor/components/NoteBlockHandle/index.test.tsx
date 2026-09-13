// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('NoteBlockHandle', () => {
  it.each([0.5, 1, 1.5].flatMap(scale => [28, 256].map(left => ({ scale, left }))))(
    'anchors controls and drop line to column $left at zoom $scale', ({ scale, left }) => {
    host = document.createElement('div');
    const editorHost = document.createElement('div');
    const controlsHost = document.createElement('div');
    host.append(editorHost, controlsHost);
    document.body.append(host);
    editor = new Editor({ element: editorHost, extensions: [StarterKit], content: '<p>中文 document</p>' });
    Object.defineProperty(host, 'offsetWidth', { value: 1200 });
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 40, width: 1200 * scale } as DOMRect);
    const block = editor.view.dom.children[0] as HTMLElement;
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({
      left: 100 + left * scale, top: 40 + 32 * scale,
      width: 704 * scale, height: 28 * scale,
    } as DOMRect);
    let onResize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { onResize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    root = createRoot(controlsHost);
    act(() => root?.render(<I18nProvider><NoteBlockHandle editor={editor!} cardRef={{ current: host! }} /></I18nProvider>));
    act(() => block.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })));
    const anchor = host.querySelector<HTMLElement>('.note-block-handle-anchor')!;
    expect(anchor.style.left).toBe(`${left - 26}px`);
    expect(anchor.style.top).toBe('32px');
    expect(anchor.querySelectorAll('button')).toHaveLength(1);
    expect(anchor.querySelector('.note-block-add')).toBeNull();
    expect(anchor.querySelector('.note-block-handle')?.getAttribute('draggable')).toBe('true');
    const dragStart = new Event('dragstart', { bubbles: true });
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
    act(() => host?.querySelector('.note-block-handle')?.dispatchEvent(dragStart));
    expect(dataTransfer.effectAllowed).toBe('move');
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-pulse-note-block', '0');
    act(() => block.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 40 + 55 * scale })));
    const line = host.querySelector<HTMLElement>('.note-block-drop-line')!;
    expect(line.style.left).toBe(`${left}px`);
    expect(line.style.width).toBe('704px');
    expect(line.style.top).toBe('60px');
    act(() => onResize());
    expect(host.querySelector('.note-block-handle-anchor')).toBeNull();
    expect(host.querySelector('.note-block-drop-line')).toBeNull();
    act(() => root?.unmount());
    root = null;
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('owns native drag start inside a canvas that cancels unclaimed browser drags', () => {
    host = document.createElement('div');
    const editorHost = document.createElement('div');
    const controlsHost = document.createElement('div');
    host.append(editorHost, controlsHost);
    document.body.append(host);
    editor = new Editor({ element: editorHost, extensions: [StarterKit], content: '<h1>Alpha</h1><p>Beta</p>' });
    root = createRoot(controlsHost);
    const cancelCanvasDrag = vi.fn((event: React.DragEvent) => event.preventDefault());
    act(() => root?.render(
      <I18nProvider><div onDragStart={cancelCanvasDrag}>
        <NoteBlockHandle editor={editor!} cardRef={{ current: host! }} />
      </div></I18nProvider>,
    ));
    act(() => editor!.view.dom.firstElementChild!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })));
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, 'dataTransfer', { value: { setData: vi.fn(), effectAllowed: '' } });
    act(() => host!.querySelector('.note-block-handle')!.dispatchEvent(dragStart));
    expect(dragStart.defaultPrevented).toBe(false);
    expect(cancelCanvasDrag).not.toHaveBeenCalled();
    // The real note save callback ignores updates while its editor is unfocused.
    const persist = vi.fn();
    editor.on('update', () => { if (editor!.isFocused) persist(editor!.getJSON()); });
    const target = editor.view.dom.children[1] as HTMLElement;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 20, height: 20 } as DOMRect);
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 39 });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [], getData: () => '', types: [] } });
    act(() => target.dispatchEvent(drop));
    expect(editor.state.doc.firstChild?.textContent).toBe('Beta');
    expect(editor.isFocused).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('waits until Tiptap has mounted an editor view', () => {
    host = document.createElement('div');
    document.body.append(host);
    const cardRef = { current: host };
    const mountingEditor = {
      get view() {
        throw new Error("[tiptap error]: The editor view is not available. Cannot access view['dom']. The editor may not be mounted yet.");
      },
      on() {},
      off() {},
    } as unknown as Editor;

    root = createRoot(host);
    expect(() => {
      act(() => root?.render(
        <I18nProvider><NoteBlockHandle editor={mountingEditor} cardRef={cardRef} /></I18nProvider>,
      ));
    }).not.toThrow();
  });

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
    act(() => editor?.view.focus());
    expect(document.querySelector('.note-block-handle')).not.toBeNull();
    act(() => firstBlock.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })));

    const handle = document.querySelector<HTMLButtonElement>('.note-block-handle');
    expect(handle).not.toBeNull();
    expect(handle?.closest<HTMLElement>('.note-block-handle-anchor')?.style.top).toBe('30px');
    act(() => handle?.click());
    expect(document.querySelector('.note-block-menu')?.textContent).toContain('Duplicate block');
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const menuItem = document.querySelector<HTMLButtonElement>('.note-block-menu [role="menuitem"]');
    act(() => menuItem?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })));
    expect(document.querySelector('.note-block-menu')).toBeNull();
    expect(document.activeElement).toBe(handle);

    act(() => handle?.click());
    act(() => editor?.view.dom.parentElement?.dispatchEvent(new Event('scroll')));
    expect(document.querySelector('.note-block-handle')).toBeNull();
    expect(document.querySelector('.note-block-menu')).toBeNull();
  });
});
