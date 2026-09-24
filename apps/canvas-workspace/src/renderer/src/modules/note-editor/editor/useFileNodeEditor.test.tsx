// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorContent } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileNodeData } from '../../../types';
import { I18nProvider } from '../../../i18n';
import { getMarkdown, useFileNodeEditor } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data: FileNodeData = {
  filePath: '',
  content: '',
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let hookState: ReturnType<typeof useFileNodeEditor> | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  hookState = null;
  vi.useRealTimers();
});

describe('useFileNodeEditor slash ownership', () => {
  it('uses the new file binding for a pending edit when note creation completes', async () => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const original = { filePath: '', content: '# Original', modified: false };
    const beforeBinding = vi.fn().mockResolvedValue(undefined);
    const afterBinding = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root?.render(<I18nProvider><ContentHarness value={original} persist={beforeBinding} /></I18nProvider>);
    });
    act(() => {
      hookState!.editor!.view.dom.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      hookState!.editor!.commands.insertContent('Local draft ');
    });
    await act(async () => {
      root?.render(<I18nProvider><ContentHarness value={{ ...original, filePath: '/tmp/new-note.md' }} persist={afterBinding} /></I18nProvider>);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(beforeBinding).not.toHaveBeenCalled();
    expect(afterBinding).toHaveBeenCalledWith(expect.stringContaining('Local draft'), '/tmp/new-note.md');
  });

  it('retains a real Tiptap edit during the content debounce when external props arrive', async () => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const original = { filePath: '/tmp/note.md', content: '# Original', modified: false };
    await act(async () => {
      root?.render(<I18nProvider><ContentHarness value={original} /></I18nProvider>);
    });
    act(() => {
      hookState!.editor!.view.dom.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      hookState!.editor!.commands.insertContent('Local draft ');
    });
    expect(getMarkdown(hookState!.editor)).toContain('Local draft');
    await act(async () => {
      root?.render(<I18nProvider><ContentHarness value={{ ...original, content: '# External' }} /></I18nProvider>);
    });
    expect(getMarkdown(hookState!.editor)).toContain('Local draft');
    expect(getMarkdown(hookState!.editor)).not.toContain('External');
    act(() => hookState!.reloadContent('# External'));
    expect(getMarkdown(hookState!.editor)).toContain('External');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(getMarkdown(hookState!.editor)).not.toContain('Local draft');
  });

  it('keeps a restored unsaved draft until an explicit reload', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const original = { filePath: '/tmp/note.md', content: '# Unsaved draft', modified: true };
    await act(async () => {
      root?.render(<I18nProvider><ContentHarness value={original} /></I18nProvider>);
    });
    await act(async () => {
      root?.render(<I18nProvider><ContentHarness value={{ ...original, content: '# External', modified: false }} /></I18nProvider>);
    });
    expect(getMarkdown(hookState!.editor)).toContain('Unsaved draft');
    act(() => hookState!.reloadContent('# External'));
    expect(getMarkdown(hookState!.editor)).toContain('External');
  });

  it('consumes Escape before canvas-level handlers and closes only the slash menu', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <EditorHarness />
        </I18nProvider>,
      );
      await Promise.resolve();
    });
    expect(hookState?.editor?.view.dom.getAttribute('aria-label')).toBe('Document editor');
    expect(hookState?.editor?.view.dom.getAttribute('aria-multiline')).toBe('true');

    await act(async () => {
      hookState?.editor?.commands.focus();
      hookState?.interactions.openSlashMenu({
        x: 20,
        y: 20,
        query: '',
        index: 0,
        slashFrom: 1,
      });
      await Promise.resolve();
    });
    expect(hookState?.slashMenu).not.toBeNull();

    const onCanvasEscape = vi.fn();
    window.addEventListener('keydown', onCanvasEscape);
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      hookState?.editor?.view.dom.dispatchEvent(escape);
    });

    expect(escape.defaultPrevented).toBe(true);
    expect(onCanvasEscape).not.toHaveBeenCalled();
    expect(hookState?.slashMenu).toBeNull();
    window.removeEventListener('keydown', onCanvasEscape);
  });
});

const ContentHarness = ({ value, persist }: { value: FileNodeData; persist?: (content: string, path: string) => Promise<void> }) => {
  const nodeIdRef = useRef('file-1');
  const dataRef = useRef(value);
  dataRef.current = value;
  const workspaceIdRef = useRef('workspace-1');
  const prevContentRef = useRef(value.content);
  const state = useFileNodeEditor({
    data: value, nodeIdRef, dataRef, workspaceIdRef, prevContentRef,
    setModified: vi.fn(), persistToFile: persist ?? vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn(),
  });
  hookState = state;
  return <EditorContent editor={state.editor} />;
};

const EditorHarness = () => {
  const state = useFileNodeEditor({
    data,
    nodeIdRef: { current: 'file-1' },
    dataRef: { current: data },
    workspaceIdRef: { current: 'workspace-1' },
    prevContentRef: { current: data.content },
    setModified: vi.fn(),
    persistToFile: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
  });
  hookState = state;

  return <EditorContent editor={state.editor} />;
};
