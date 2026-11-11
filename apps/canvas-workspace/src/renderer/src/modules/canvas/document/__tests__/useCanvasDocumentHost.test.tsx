// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../types';
import { useCanvasDocumentHost } from '../useCanvasDocumentHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notify = vi.fn();
let agentCreated: (node: CanvasNode) => void;

vi.mock('../../../../shared/appShell', () => ({
  useAppShell: () => ({ notify, dismissToast: vi.fn() }),
}));
vi.mock('../../../../i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  }),
}));
vi.mock('../useCanvasDocument', () => ({
  useCanvasDocument: (_id: string, _restore: unknown, onAgentCreated: (node: CanvasNode) => void) => {
    agentCreated = onAgentCreated;
    return { flushSave: vi.fn() };
  },
}));

const note = (id: string, x: number, y: number): CanvasNode => ({
  id, type: 'file', title: id, x, y, width: 400, height: 300, data: {} as CanvasNode['data'],
});

describe('useCanvasDocumentHost agent-created toast', () => {
  let root: Root;
  const focusNode = vi.fn();
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 }) as DOMRect;

  const Probe = () => {
    useCanvasDocumentHost({
      canvasId: 'canvas-1',
      persistViewport: false,
      containerRef: { current: container },
      transform: { x: 0, y: 0, scale: 1 },
      setTransform: vi.fn(),
      focusNode,
    });
    return null;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it('shows one toast for a batch of off-screen nodes and jumps to their bounds', () => {
    agentCreated(note('a', 2000, 2000));
    agentCreated(note('b', 2600, 2000));
    agentCreated(note('visible', 100, 100));
    expect(notify).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);

    expect(notify).toHaveBeenCalledTimes(1);
    const toast = notify.mock.calls[0][0];
    expect(toast.title).toBe('canvas.agentAddedNodes:{"count":2}');
    toast.action.onClick();
    expect(focusNode).toHaveBeenCalledWith(expect.objectContaining({ x: 2000, y: 2000, width: 1000, height: 300 }));
  });

  it('names a single off-screen node', () => {
    agentCreated(note('Plan', 2000, 2000));
    vi.advanceTimersByTime(400);
    expect(notify.mock.calls[0][0].description).toBe('Plan · canvas.agentAddedNodeOffscreen');
  });

  it('jumps to the first node when the batch is too far apart to read in one view', () => {
    const first = note('a', 2000, 2000);
    agentCreated(first);
    agentCreated(note('b', 20000, 20000));
    vi.advanceTimersByTime(400);
    notify.mock.calls[0][0].action.onClick();
    expect(focusNode).toHaveBeenCalledWith(first);
  });
});
