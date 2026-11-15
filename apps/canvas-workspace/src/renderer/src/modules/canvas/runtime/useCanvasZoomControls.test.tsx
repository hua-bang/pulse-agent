// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useCanvasZoomControls, type CanvasZoomControls } from './useCanvasZoomControls';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useCanvasZoomControls centerOn', () => {
  it('pans so the canvas point lands at the view centre', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    const panBy = vi.fn<[number, number], void>();
    let controls!: CanvasZoomControls;
    const Probe = () => {
      controls = useCanvasZoomControls({
        containerRef: { current: container },
        zoomByStep: vi.fn(),
        zoomToScale: vi.fn(),
        fitAllNodes: vi.fn(),
        visibleNodes: [],
        selectedNodeIds: [],
        panBy,
        getLiveTransform: () => ({ x: 50, y: -20, scale: 2 }),
      });
      return null;
    };
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));

    controls.centerOn(100, 100);

    // Centre (400, 300) minus the point at scale 2 (200, 200) minus the
    // current translate (50, -20).
    expect(panBy).toHaveBeenCalledWith(150, 120);
    expect(controls.getViewportSize()).toEqual({ width: 800, height: 600 });
    act(() => root.unmount());
  });
});
