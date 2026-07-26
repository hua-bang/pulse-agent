// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorContent } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileNodeData } from '../types';
import { I18nProvider } from '../i18n';
import { getMarkdown, useFileNodeEditor } from './useFileNodeEditor';

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
});

describe('useFileNodeEditor slash ownership', () => {
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

describe('useFileNodeEditor rich text colors', () => {
  it('preserves text and highlight colors through the Markdown roundtrip', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <EditorHarness initialData={{ filePath: '', content: 'Alpha' }} />
        </I18nProvider>,
      );
      await Promise.resolve();
    });

    const editor = hookState?.editor;
    expect(editor).not.toBeNull();
    act(() => {
      editor?.commands.setTextSelection({ from: 1, to: 6 });
      editor?.chain()
        .setMark('textColor', { color: '#e03131' })
        .setHighlight({ color: '#d0ebff' })
        .run();
    });
    const markdown = getMarkdown(editor);
    expect(markdown).toContain('color: #e03131');
    expect(markdown).toContain('background-color: #d0ebff');

    act(() => root?.unmount());
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <I18nProvider>
          <EditorHarness initialData={{ filePath: '', content: markdown }} />
        </I18nProvider>,
      );
      await Promise.resolve();
    });

    expect(hookState?.editor?.isActive('textColor', { color: '#e03131' })).toBe(true);
    expect(hookState?.editor?.isActive('highlight', { color: '#d0ebff' })).toBe(true);
  });
});

const EditorHarness = ({ initialData = data }: { initialData?: FileNodeData }) => {
  const state = useFileNodeEditor({
    data: initialData,
    nodeIdRef: { current: 'file-1' },
    dataRef: { current: initialData },
    workspaceIdRef: { current: 'workspace-1' },
    prevContentRef: { current: initialData.content },
    setModified: vi.fn(),
    persistToFile: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
  });
  hookState = state;

  return <EditorContent editor={state.editor} />;
};
