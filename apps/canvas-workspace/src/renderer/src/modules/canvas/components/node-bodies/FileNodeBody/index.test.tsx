// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import type { CanvasNode } from '../../../../../types';

const mocks = vi.hoisted(() => ({
  editor: {
    commands: { focus: vi.fn() },
  },
  getMarkdown: vi.fn(() => '# Recovery draft'),
  options: null as null | {
    onCommitState?: (state: 'saving' | 'saved' | 'error') => void;
    onContentChange?: () => void;
    persistToFile?: (markdown: string, filePath: string) => Promise<void>;
  },
  write: vi.fn(),
}));

vi.mock('../../../../../hooks/useFileNodeEditor', () => ({
  getMarkdown: mocks.getMarkdown,
  useFileNodeEditor: (options: typeof mocks.options) => {
    mocks.options = options;
    return {
      editor: mocks.editor,
      interactions: {},
      handleSlashSelect: vi.fn(),
      openLinkPrompt: vi.fn(),
      applyLink: vi.fn(),
      cancelLink: vi.fn(),
      imageInputRef: { current: null },
      insertImageFromFile: vi.fn(),
    };
  },
}));

vi.mock('../../../../../hooks/useFileNodeEditorRegistry', () => ({
  useFileNodeEditorRegistry: () => null,
}));

vi.mock('../../../../../hooks/useNoteMentions', () => ({
  useNoteMentions: () => ({
    filteredMentions: [],
    insertMention: vi.fn(),
    closeMention: vi.fn(),
  }),
}));

vi.mock('../../../../../hooks/useNoteOutlineEscape', () => ({
  useNoteOutlineEscape: vi.fn(),
}));

vi.mock('../../../../note-editor/surface', () => ({
  FileNodeEditorSurface: () => <div data-testid="editor-surface" />,
}));

vi.mock('../../../../../components/dock/RightDock', () => ({
  useRightDock: () => ({ openLink: vi.fn() }),
}));

import { FileNodeBody } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const node = {
  id: 'note-1',
  type: 'file',
  title: 'Recovery note',
  x: 0,
  y: 0,
  width: 480,
  height: 360,
  data: {
    content: '# Previous',
    filePath: '/tmp/recovery-note.md',
    modified: true,
  },
} as CanvasNode;

afterEach(() => {
  vi.useRealTimers();
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  mocks.options = null;
  mocks.write.mockReset();
  mocks.getMarkdown.mockClear();
});

describe('FileNodeBody save recovery', () => {
  it('announces a persistent save error and retries the current editor content', async () => {
    vi.useFakeTimers();
    mocks.write.mockResolvedValue({ ok: true });
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { file: { write: mocks.write } },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <I18nProvider>
          <FileNodeBody node={node} workspaceId="workspace-1" onUpdate={vi.fn()} />
        </I18nProvider>,
      );
    });

    act(() => mocks.options?.onCommitState?.('error'));

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Save failed');
    const retry = alert?.querySelector('button');
    expect(retry?.textContent).toBe('Retry');

    act(() => vi.advanceTimersByTime(3000));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Save failed');

    await act(async () => {
      retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.getMarkdown).toHaveBeenCalledWith(mocks.editor);
    expect(mocks.write).toHaveBeenCalledWith('/tmp/recovery-note.md', '# Recovery draft');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Saved');
  });

  it('serializes overlapping writes and lets only the newest revision report Saved', async () => {
    let resolveFirst!: (value: { ok: boolean }) => void;
    let resolveSecond!: (value: { ok: boolean }) => void;
    const first = new Promise<{ ok: boolean }>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<{ ok: boolean }>((resolve) => {
      resolveSecond = resolve;
    });
    mocks.write
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { file: { write: mocks.write } },
    });
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <I18nProvider>
          <FileNodeBody node={node} workspaceId="workspace-1" onUpdate={onUpdate} />
        </I18nProvider>,
      );
    });

    let firstSave: Promise<void> | undefined;
    let secondSave: Promise<void> | undefined;
    act(() => {
      firstSave = mocks.options?.persistToFile?.('# Older', '/tmp/recovery-note.md');
      secondSave = mocks.options?.persistToFile?.('# Newest', '/tmp/recovery-note.md');
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenNthCalledWith(1, '/tmp/recovery-note.md', '# Older');

    await act(async () => {
      resolveFirst({ ok: true });
      await firstSave;
      await Promise.resolve();
    });
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.write).toHaveBeenNthCalledWith(2, '/tmp/recovery-note.md', '# Newest');
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();

    await act(async () => {
      resolveSecond({ ok: true });
      await secondSave;
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]?.[1]).toMatchObject({
      data: { content: '# Newest', saved: true, modified: false },
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Saved');
  });

  it('invalidates an in-flight write immediately when the editor changes', async () => {
    let resolveOldWrite!: (value: { ok: boolean }) => void;
    const oldWrite = new Promise<{ ok: boolean }>((resolve) => {
      resolveOldWrite = resolve;
    });
    mocks.write.mockImplementationOnce(() => oldWrite);
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { file: { write: mocks.write } },
    });
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <I18nProvider>
          <FileNodeBody node={node} workspaceId="workspace-1" onUpdate={onUpdate} />
        </I18nProvider>,
      );
    });

    let save: Promise<void> | undefined;
    act(() => {
      save = mocks.options?.persistToFile?.('# Older', '/tmp/recovery-note.md');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.write).toHaveBeenCalledTimes(1);

    act(() => {
      // Mirrors Tiptap's immediate onUpdate signal; the debounced commit and
      // replacement auto-save have intentionally not started yet.
      mocks.options?.onContentChange?.();
    });
    await act(async () => {
      resolveOldWrite({ ok: true });
      await save;
    });

    expect(onUpdate).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
