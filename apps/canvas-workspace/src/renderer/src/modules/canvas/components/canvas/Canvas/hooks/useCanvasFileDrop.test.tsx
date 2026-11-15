// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../../../types';
import { I18nProvider } from '../../../../../../i18n';
import { FILE_PATH_DRAG_TYPE } from '../../../../../../shared/dock/file-path-drag';
import { readTextDrop, useCanvasFileDrop } from './useCanvasFileDrop';

const notify = vi.fn(() => 'toast-1');
const updateToast = vi.fn();
vi.mock('../../../../../../shared/appShell', () => ({ useAppShell: () => ({ notify, updateToast }) }));
vi.mock('../../../../runtime/canvasImageFile', () => ({
  saveImageAsNodePatch: vi.fn(async (_canvasId: string, _file: File, title: string) => (
    { width: 200, height: 100, title, data: {} }
  )),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fileDrop = (files: File[]) => {
  const event = new MouseEvent('drop', { clientX: 600, clientY: 400, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files } });
  return event;
};

// Regression: files dragged in from the OS did nothing at all.
it('turns a dropped Markdown file into one note under the pointer and names unsupported files', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const container = document.createElement('div'); document.body.append(container);
  const addNode = vi.fn((type: CanvasNode['type'], x: number, y: number) => (
    { id: 'note-1', type, x, y, width: 420, height: 360, title: 'notes', data: {} } as unknown as CanvasNode
  ));
  const setSelectedNodeIds = vi.fn();
  const Probe = () => {
    useCanvasFileDrop({
      canvasId: 'ws',
      containerRef: { current: container },
      loaded: true,
      screenToCanvas: (x, y) => ({ x: x / 2, y: y / 2 }),
      addNode,
      nodesRef: { current: [] },
      setSelectedNodeIds,
    });
    return null;
  };
  const root = createRoot(host);
  try {
    act(() => root.render(<I18nProvider><Probe /></I18nProvider>));
    const over = new MouseEvent('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: { types: ['Files'], dropEffect: 'none' } });
    act(() => container.dispatchEvent(over));
    expect(over.defaultPrevented).toBe(true);
    expect(container.classList.contains('canvas-container--file-drop')).toBe(true);

    const drop = fileDrop([
      new File(['# Plan\nShip it'], 'plan.md', { type: 'text/markdown' }),
      new File(['zip'], 'archive.zip', { type: 'application/zip' }),
    ]);
    await act(async () => {
      container.dispatchEvent(drop);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(drop.defaultPrevented).toBe(true);
    expect(container.classList.contains('canvas-container--file-drop')).toBe(false);
    // Centred on the drop point (300, 200) and created in a single call.
    expect(addNode).toHaveBeenCalledTimes(1);
    expect(addNode).toHaveBeenCalledWith('file', 90, 20, expect.objectContaining({
      fileName: 'plan',
      fileContent: '# Plan\nShip it',
      nodePatch: expect.objectContaining({ title: 'plan' }),
    }));
    expect(setSelectedNodeIds).toHaveBeenCalledWith(['note-1']);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('archive.zip') }));
  } finally {
    act(() => root.unmount());
    host.remove();
    container.remove();
  }
});

describe('readTextDrop', () => {
  const transfer = (data: Record<string, string>) => ({ getData: (type: string) => data[type] ?? '' });

  it('reads the first link of a uri-list and skips its comments', () => {
    expect(readTextDrop(transfer({
      'text/uri-list': '# from browser\r\nhttps://example.com/a\r\nhttps://example.com/b',
      'text/plain': 'Example',
    }))).toEqual({ kind: 'url', url: 'https://example.com/a' });
  });

  it('treats URL-shaped plain text as a link and prose as text', () => {
    expect(readTextDrop(transfer({ 'text/plain': 'example.com/docs' })))
      .toEqual({ kind: 'url', url: 'https://example.com/docs' });
    expect(readTextDrop(transfer({ 'text/plain': 'Ship the plan on Friday' })))
      .toEqual({ kind: 'text', text: 'Ship the plan on Friday' });
    expect(readTextDrop(transfer({ 'text/plain': '   ' }))).toBeNull();
  });
});

const renderDrop = (overrides: Partial<Parameters<typeof useCanvasFileDrop>[0]> = {}) => {
  const host = document.createElement('div'); document.body.append(host);
  const container = document.createElement('div'); document.body.append(container);
  let count = 0;
  const addNode = vi.fn((type: CanvasNode['type'], x: number, y: number) => (
    { id: `node-${++count}`, type, x, y, width: 200, height: 100, title: '', data: {} } as unknown as CanvasNode
  ));
  const setSelectedNodeIds = vi.fn();
  const Probe = () => {
    useCanvasFileDrop({
      canvasId: 'ws',
      containerRef: { current: container },
      loaded: true,
      screenToCanvas: (x, y) => ({ x, y }),
      addNode,
      nodesRef: { current: [] },
      setSelectedNodeIds,
      ...overrides,
    });
    return null;
  };
  const root = createRoot(host);
  act(() => root.render(<I18nProvider><Probe /></I18nProvider>));
  const cleanup = () => {
    act(() => root.unmount());
    host.remove();
    container.remove();
  };
  return { addNode, cleanup, container, setSelectedNodeIds };
};

const textDrop = (data: Record<string, string>) => {
  const event = new MouseEvent('drop', { clientX: 500, clientY: 300, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: Object.keys(data), files: [], getData: (type: string) => data[type] ?? '' },
  });
  return event;
};

it('turns a dropped link into a web node centred on the pointer', () => {
  const createUrlNode = vi.fn(() => null);
  const { addNode, cleanup, container } = renderDrop({ createUrlNode });
  try {
    const drop = textDrop({ 'text/uri-list': 'https://example.com/', 'text/plain': 'https://example.com/' });
    act(() => container.dispatchEvent(drop));
    expect(drop.defaultPrevented).toBe(true);
    expect(createUrlNode).toHaveBeenCalledWith('https://example.com/', { at: { x: 500, y: 300 } });
    expect(addNode).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

it('turns dropped plain text into a selected text node at the pointer', () => {
  const { addNode, cleanup, container, setSelectedNodeIds } = renderDrop();
  try {
    act(() => container.dispatchEvent(textDrop({ 'text/plain': 'Remember the milk' })));
    expect(addNode).toHaveBeenCalledWith('text', expect.any(Number), expect.any(Number), {
      nodePatch: expect.objectContaining({ title: 'Remember the milk' }),
    });
    expect(setSelectedNodeIds).toHaveBeenCalledWith(['node-1']);
  } finally {
    cleanup();
  }
});

it('reports progress while several images are added', async () => {
  notify.mockClear();
  updateToast.mockClear();
  const { addNode, cleanup, container } = renderDrop();
  try {
    await act(async () => {
      container.dispatchEvent(fileDrop([
        new File(['a'], 'a.png', { type: 'image/png' }),
        new File(['b'], 'b.png', { type: 'image/png' }),
      ]));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(addNode).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'loading' }));
    expect(updateToast).toHaveBeenCalledWith('toast-1', expect.objectContaining({ title: expect.stringContaining('1') }));
    expect(updateToast).toHaveBeenLastCalledWith('toast-1', expect.objectContaining({ tone: 'success' }));
  } finally {
    cleanup();
  }
});

// A dock folder-tab entry carries only a path, never OS files; the canvas leaves it alone.
it('ignores entries dragged from a dock folder tab', () => {
  const host = document.createElement('div'); document.body.append(host);
  const container = document.createElement('div'); document.body.append(container);
  const addNode = vi.fn();
  const Probe = () => {
    useCanvasFileDrop({
      canvasId: 'ws',
      containerRef: { current: container },
      loaded: true,
      screenToCanvas: (x, y) => ({ x, y }),
      addNode,
      nodesRef: { current: [] },
      setSelectedNodeIds: vi.fn(),
    });
    return null;
  };
  const root = createRoot(host);
  try {
    act(() => root.render(<I18nProvider><Probe /></I18nProvider>));
    const transfer = { types: [FILE_PATH_DRAG_TYPE, 'text/plain'], files: [], dropEffect: 'none' };
    const over = new MouseEvent('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: transfer });
    act(() => container.dispatchEvent(over));
    expect(over.defaultPrevented).toBe(false);
    expect(container.classList.contains('canvas-container--file-drop')).toBe(false);

    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: transfer });
    act(() => container.dispatchEvent(drop));
    expect(drop.defaultPrevented).toBe(false);
    expect(addNode).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    host.remove();
    container.remove();
  }
});
