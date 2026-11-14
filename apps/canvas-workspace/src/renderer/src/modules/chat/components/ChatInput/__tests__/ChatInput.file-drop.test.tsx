// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { FILE_PATH_DRAG_TYPE } from '../../../../../shared/dock/file-path-drag';
import { ChatInput } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseProps = {
  loading: false,
  input: '',
  contextComposer: true,
  editableRef: createRef<HTMLDivElement>(),
  onInput: vi.fn(),
  onKeyDown: vi.fn(),
  onPaste: vi.fn(),
  onSend: vi.fn(async () => true),
  onAbort: vi.fn(async () => true),
};

interface OsEntry {
  file: File;
  path: string;
  isDirectory?: boolean;
}

const paths = new Map<File, string>();
const canvasWorkspace = { file: { getPathForFile: (file: File) => paths.get(file) ?? '' } };

const dragEvent = (type: string, dataTransfer: object) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
};

const osTransfer = (entries: OsEntry[]) => {
  for (const entry of entries) paths.set(entry.file, entry.path);
  return {
    types: ['Files'],
    dropEffect: 'none',
    files: entries.map(entry => entry.file),
    items: entries.map(entry => ({
      kind: 'file',
      getAsFile: () => entry.file,
      webkitGetAsEntry: () => ({ isDirectory: entry.isDirectory === true }),
    })),
    getData: () => '',
  };
};

const treeTransfer = (path: string, isDirectory: boolean) => ({
  types: [FILE_PATH_DRAG_TYPE, 'text/plain'],
  dropEffect: 'none',
  files: [],
  items: [],
  getData: (type: string) => (
    type === FILE_PATH_DRAG_TYPE ? JSON.stringify({ path, isDirectory }) : path
  ),
});

const renderInput = (props: Partial<Parameters<typeof ChatInput>[0]>) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(
    <I18nProvider>
      <ChatInput {...baseProps} {...props} />
    </I18nProvider>,
  ));
  const box = host.querySelector<HTMLElement>('.chat-input-box')!;
  const cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { box, cleanup };
};

afterEach(() => {
  paths.clear();
  Reflect.deleteProperty(window, 'canvasWorkspace');
});

describe('ChatInput file drop', () => {
  // Regression: files dropped on the composer did nothing at all.
  it('attaches OS images and mentions other OS files and folders by path', () => {
    Object.assign(window, { canvasWorkspace });
    const onAttachFiles = vi.fn();
    const onInsertFile = vi.fn();
    const { box, cleanup } = renderInput({ onAttachFiles, onInsertFile });
    try {
      const image = new File(['png'], 'shot.png', { type: 'image/png' });
      const pdf = new File(['pdf'], 'spec.pdf', { type: 'application/pdf' });
      const folder = new File([], 'src', { type: '' });
      const transfer = osTransfer([
        { file: image, path: '/u/shot.png' },
        { file: pdf, path: '/u/spec.pdf' },
        { file: folder, path: '/u/src', isDirectory: true },
      ]);

      const over = dragEvent('dragover', transfer);
      act(() => { box.dispatchEvent(over); });
      expect(over.defaultPrevented).toBe(true);
      expect(box.classList.contains('chat-input-box--file-drop')).toBe(true);

      const drop = dragEvent('drop', transfer);
      act(() => { box.dispatchEvent(drop); });
      expect(drop.defaultPrevented).toBe(true);
      expect(box.classList.contains('chat-input-box--file-drop')).toBe(false);
      expect(onAttachFiles).toHaveBeenCalledWith([image]);
      expect(onInsertFile.mock.calls).toEqual([
        ['/u/spec.pdf', false],
        ['/u/src', true],
      ]);
    } finally {
      cleanup();
    }
  });

  it('skips a non-image file that has no real path', () => {
    Object.assign(window, { canvasWorkspace });
    const onInsertFile = vi.fn();
    const { box, cleanup } = renderInput({ onAttachFiles: vi.fn(), onInsertFile });
    try {
      const file = new File(['x'], 'page.html', { type: 'text/html' });
      act(() => { box.dispatchEvent(dragEvent('drop', osTransfer([{ file, path: '' }]))); });
      expect(onInsertFile).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('mentions an entry dragged from a dock folder tab', () => {
    const onInsertFile = vi.fn();
    const { box, cleanup } = renderInput({ onInsertFile });
    try {
      const drop = dragEvent('drop', treeTransfer('/repo/packages', true));
      act(() => { box.dispatchEvent(drop); });
      expect(drop.defaultPrevented).toBe(true);
      expect(onInsertFile).toHaveBeenCalledWith('/repo/packages', true);
    } finally {
      cleanup();
    }
  });

  it('refuses drops while interaction is disabled', () => {
    const onInsertFile = vi.fn();
    const { box, cleanup } = renderInput({ onInsertFile, interactionDisabled: true });
    try {
      const over = dragEvent('dragover', treeTransfer('/repo/a.ts', false));
      act(() => { box.dispatchEvent(over); });
      expect(over.defaultPrevented).toBe(false);
      act(() => { box.dispatchEvent(dragEvent('drop', treeTransfer('/repo/a.ts', false))); });
      expect(onInsertFile).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});
