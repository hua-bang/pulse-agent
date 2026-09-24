// @vitest-environment happy-dom
import { act, lazy, Suspense, useEffect, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeferredEditorBoundary, useDeferredEditorInput } from './useDeferredEditorInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Deferred native editor input', () => {
  let host: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof useDeferredEditorInput>;
  let identity: string;

  const Probe = () => {
    api = useDeferredEditorInput({ identity, label: 'Pending note input' });
    return <>{api.input}</>;
  };
  const input = () => host.querySelector<HTMLDivElement>('[data-deferred-editor-input]')!;
  const edit = (text: string, composing = false) => {
    input().textContent = text;
    input().dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', isComposing: composing }));
  };
  const paste = (text: string, html = '') => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => type === 'text/html' ? html : text },
    });
    input().dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    identity = 'note-1';
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('focuses synchronously and hands the first character to a delayed ready port once', () => {
    const point = { x: 120, y: 80, scrollTop: 40 };
    act(() => {
      api.begin(point);
      expect(document.activeElement).toBe(input());
      expect(input().hidden).toBe(false);
      edit('a');
    });
    const handoff = vi.fn();
    act(() => { api.ready(handoff); });
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(handoff).toHaveBeenCalledWith({ html: 'a', text: 'a', point, deletions: [] });
    expect(input().hidden).toBe(true);
    act(() => { api.ready(handoff); });
    expect(handoff).toHaveBeenCalledTimes(1);
  });

  it('does not focus or hand off when search merely registers a ready editor', () => {
    const external = document.createElement('input');
    host.append(external);
    external.focus();
    const handoff = vi.fn();
    act(() => { api.ready(handoff); });
    expect(document.activeElement).toBe(external);
    expect(handoff).not.toHaveBeenCalled();
    expect(input().hidden).toBe(true);
  });

  it('keeps the same native DOM through readiness until composition commits', () => {
    const handoff = vi.fn();
    act(() => api.begin());
    const composingInput = input();
    act(() => {
      composingInput.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      edit('拼', true);
      api.ready(handoff);
    });
    expect(handoff).not.toHaveBeenCalled();
    expect(input()).toBe(composingInput);
    expect(input().hidden).toBe(false);
    act(() => {
      input().textContent = '拼音';
      input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '拼音' }));
      input().dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(handoff.mock.calls[0][0].text).toBe('拼音');
  });

  it('prevents HTML paste and sanitizes before any rich content enters the pending DOM', () => {
    act(() => api.begin());
    let event!: Event;
    act(() => {
      event = paste('safe bold', '<p><strong>safe bold</strong><span style="color: red; position: fixed" onclick="alert(1)">red</span></p>'
        + '<script>alert(1)</script><iframe>frame</iframe><img src="https://example.invalid/remote.png" onerror="alert(1)">');
    });
    expect(event.defaultPrevented).toBe(true);
    expect(input().querySelector('strong')?.textContent).toBe('safe bold');
    expect(input().querySelector('span')?.style.color).toBe('red');
    expect(input().querySelector('span')?.style.position).toBe('');
    expect(input().querySelector('script, iframe, img, object, embed, input, form')).toBeNull();
    expect(input().innerHTML).not.toMatch(/onclick|onerror|alert\(1\)/);
    expect(input().hidden).toBe(false);
    const handoff = vi.fn();
    act(() => { api.ready(handoff); });
    expect(handoff.mock.calls[0][0].html).toContain('<strong>safe bold</strong>');
  });

  it('inserts plain clipboard data as literal text, not HTML', () => {
    act(() => api.begin());
    act(() => { paste('<b>literal</b>\nnext'); });
    expect(input().querySelector('b')).toBeNull();
    expect(input().textContent).toBe('<b>literal</b>\nnext');
    expect(input().innerHTML).toContain('&lt;b&gt;literal&lt;/b&gt;');
  });

  it('records simple empty-buffer deletions, including after buffered text is removed', () => {
    act(() => api.begin());
    const backward = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    const forward = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    act(() => {
      input().dispatchEvent(backward);
      input().dispatchEvent(forward);
      edit('typed');
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      edit('');
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });
    expect(backward.defaultPrevented).toBe(true);
    expect(forward.defaultPrevented).toBe(true);
    const handoff = vi.fn();
    act(() => { api.ready(handoff); });
    expect(handoff.mock.calls[0][0].deletions).toEqual(['backward', 'forward', 'backward']);
  });

  it('rejects a rich HTML drop before the browser can insert it while still pending', () => {
    act(() => { api.begin(); edit('keep'); });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { getData: () => '<img src=x onerror=alert(1)><iframe>unsafe</iframe>' },
    });
    act(() => { input().dispatchEvent(drop); });
    expect(drop.defaultPrevented).toBe(true);
    expect(input().innerHTML).toBe('keep');
    expect(input().hidden).toBe(false);
  });

  it('keeps failed handoff content visible and copyable until a port accepts it', () => {
    act(() => { api.begin(); edit('keep me'); });
    act(() => { api.ready(() => false); });
    expect(input().hidden).toBe(false);
    expect(input().textContent).toBe('keep me');
    act(() => { api.ready(() => { throw new Error('editor unavailable'); }); });
    expect(input().hidden).toBe(false);
    const selection = window.getSelection()!;
    selection.selectAllChildren(input());
    expect(selection.toString()).toBe('keep me');
    const handoff = vi.fn();
    act(() => { api.ready(handoff); });
    expect(handoff.mock.calls[0][0].text).toBe('keep me');
  });

  it('isolates identities, cancelled input, and obsolete ready disposers', () => {
    const oldReady = api.ready;
    act(() => { api.begin(); edit('old'); });
    identity = 'note-2';
    act(() => root.render(<Probe />));
    expect(input().hidden).toBe(true);
    const stale = vi.fn();
    oldReady(stale);
    const first = vi.fn();
    const second = vi.fn();
    const dispose = api.ready(first);
    api.ready(second);
    dispose();
    act(() => api.begin());
    expect(first).not.toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    act(() => { api.ready(() => false); api.begin(); edit('cancelled'); api.cancel(); });
    const later = vi.fn();
    act(() => { api.ready(later); });
    expect(later).not.toHaveBeenCalled();
    expect(input().hidden).toBe(true);
  });

  it('retains the input outside Suspense and its boundary when a lazy editor import rejects', async () => {
    let reject!: (error: Error) => void;
    const LazyEditor = lazy(() => new Promise<{ default: ComponentType }>((_resolve, rejectLoad) => { reject = rejectLoad; }));
    const Fixture = () => {
      api = useDeferredEditorInput({ identity, label: 'Pending note input' });
      return <>{api.input}<DeferredEditorBoundary fallback={<p>Preview</p>}><Suspense fallback={<p>Loading</p>}><LazyEditor /></Suspense></DeferredEditorBoundary></>;
    };
    await act(async () => root.render(<Fixture />));
    act(() => { api.begin(); edit('still here'); });
    const buffer = input();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => reject(new Error('import failed')));
    expect(host.textContent).toContain('Preview');
    expect(input()).toBe(buffer);
    expect(input().hidden).toBe(false);
    expect(input().textContent).toBe('still here');
  });

  it('replays input typed before a real delayed React lazy module becomes ready', async () => {
    let resolve!: (module: { default: ComponentType }) => void;
    const handoff = vi.fn();
    const Editor = () => {
      useEffect(() => api.ready(handoff), []);
      return <div contentEditable aria-label="Real editor" />;
    };
    const LazyEditor = lazy(() => new Promise<{ default: ComponentType }>((resolveLoad) => { resolve = resolveLoad; }));
    const Fixture = () => {
      api = useDeferredEditorInput({ identity, label: 'Pending note input' });
      return <>{api.input}<Suspense fallback={<p>Loading</p>}><LazyEditor /></Suspense></>;
    };
    await act(async () => root.render(<Fixture />));
    act(() => { api.begin(); edit('first character'); });
    expect(handoff).not.toHaveBeenCalled();
    await act(async () => resolve({ default: Editor }));
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(handoff.mock.calls[0][0].text).toBe('first character');
    expect(input().hidden).toBe(true);
  });
});
