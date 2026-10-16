// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCanvasFit } from './useCanvasFit';
import type { CanvasNode, CanvasTransform } from '../../../types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { vi.unstubAllGlobals(); });

describe('reference visibility beside the dock', () => {
  it.each([750, 600])('pans only the obscured reference using the measured dock edge %s', async (dockLeft) => {
    let resize = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    const canvas = document.createElement('div');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }) as DOMRect;
    const dock = document.createElement('aside');
    dock.className = 'right-dock';
    dock.dataset.expanded = 'true';
    dock.getBoundingClientRect = () => ({ left: dockLeft, top: 0, right: 1200, bottom: 800, width: 1200 - dockLeft, height: 800 }) as DOMRect;
    document.body.append(canvas, dock);
    const initial = { x: 50, y: 70, scale: 1 };
    let transform: CanvasTransform = initial;
    const setTransform = vi.fn((next: CanvasTransform) => { transform = next; });
    let api: ReturnType<typeof useCanvasFit>;
    const Probe = () => {
      api = useCanvasFit({ current: canvas }, setTransform);
      return null;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    const node = { id: 'brief', x: 600, y: 180, width: 300, height: 350 } as CanvasNode;
    // Optional call lets the old hook demonstrate the missing behavior.
    act(() => (api as any).revealNode?.(node, () => transform));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); resize(); });
    expect(node.x * transform.scale + transform.x + node.width * transform.scale).toBeLessThanOrEqual(dockLeft - 24);
    expect(transform.scale).toBe(initial.scale);
    expect(transform.y).toBe(initial.y);
    expect(node.x).toBe(600);
    setTransform.mockClear();
    act(() => resize());
    expect(setTransform).not.toHaveBeenCalled();
    act(() => root.unmount());
    canvas.remove();
    dock.remove();
  });
});
