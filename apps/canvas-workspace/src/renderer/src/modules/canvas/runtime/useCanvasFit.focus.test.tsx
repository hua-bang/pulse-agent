// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCanvasFit } from './useCanvasFit';
import type { CanvasNode, CanvasTransform } from '../../../types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { vi.unstubAllGlobals(); });

describe('focus on a canvas that is not shown yet', () => {
  it('waits for the container size instead of framing against an empty box', () => {
    let resize = () => {};
    const disconnected = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() { disconnected(); }
    });
    // "Open on canvas" from Knowledge requests focus while the canvas route
    // is still hidden, so the container measures 0x0 at that moment.
    let size = { width: 0, height: 0 };
    const canvas = document.createElement('div');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, ...size }) as DOMRect;
    const setTransform = vi.fn((_next: CanvasTransform) => {});
    let api: ReturnType<typeof useCanvasFit>;
    const Probe = () => {
      api = useCanvasFit({ current: canvas }, setTransform);
      return null;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    const node = { id: 'note', x: 100, y: 200, width: 400, height: 300 } as CanvasNode;

    act(() => api.handleFocusNode(node, { maxScale: 1 }));
    expect(setTransform).not.toHaveBeenCalled();

    size = { width: 800, height: 600 };
    act(() => resize());
    expect(setTransform).toHaveBeenCalledTimes(1);
    expect(setTransform).toHaveBeenCalledWith({ x: 100, y: -50, scale: 1 });
    expect(disconnected).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
