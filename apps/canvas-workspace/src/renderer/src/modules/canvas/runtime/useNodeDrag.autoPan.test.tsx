// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../types';
import { useNodeDrag } from './useNodeDrag';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node = { id: 'n1', x: 100, y: 100, width: 80, height: 40 } as CanvasNode;

describe('useNodeDrag auto-pan', () => {
  let root: Root;
  let hook: ReturnType<typeof useNodeDrag>;
  let frames: FrameRequestCallback[];
  const moveNode = vi.fn();
  const panBy = vi.fn();
  const viewport = document.createElement('div');
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600 }) as DOMRect;

  const Probe = () => {
    hook = useNodeDrag(moveNode, vi.fn(), 1, [node], [], { getViewport: () => viewport, panBy });
    return null;
  };

  // Cmd turns snapping off, so the node position is exact.
  const mouse = (clientX: number, clientY: number) => new MouseEvent('mousemove', { clientX, clientY, metaKey: true });
  const runFrames = (count: number) => {
    for (let index = 0; index < count; index += 1) {
      const pending = frames;
      frames = [];
      act(() => pending.forEach((frame) => frame(0)));
    }
  };

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    moveNode.mockReset();
    panBy.mockReset();
  });

  it('pans while the pointer rests at the edge and keeps the node under it', () => {
    act(() => {
      hook.onDragStart({ button: 0, altKey: false, clientX: 400, clientY: 300, stopPropagation: () => {} } as unknown as React.MouseEvent, node);
      hook.onDragMove(mouse(799, 300));
    });
    runFrames(3);

    expect(panBy).toHaveBeenCalled();
    const panned = panBy.mock.calls.reduce((sum, [dx]) => sum + (dx as number), 0);
    expect(panned).toBeLessThan(0);

    act(() => hook.onDragEnd());
    // Pointer moved +399px and the view moved `panned`px, so the node moved
    // 399 - panned canvas px (scale 1).
    const [id, x, y] = moveNode.mock.calls[0]!;
    expect(id).toBe('n1');
    expect(x).toBe(100 + 399 - panned);
    expect(y).toBe(100);
  });

  it('does not pan away from the edges', () => {
    act(() => {
      hook.onDragStart({ button: 0, altKey: false, clientX: 400, clientY: 300, stopPropagation: () => {} } as unknown as React.MouseEvent, node);
      hook.onDragMove(mouse(450, 320));
    });
    runFrames(3);
    expect(panBy).not.toHaveBeenCalled();
    act(() => hook.onDragEnd());
  });
});
