// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../../../types';
import { I18nProvider } from '../../../../../../i18n';
import { useCanvasFileDrop } from './useCanvasFileDrop';

const notify = vi.fn();
vi.mock('../../../../../../shared/appShell', () => ({ useAppShell: () => ({ notify }) }));

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
