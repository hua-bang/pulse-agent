// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { constrainToSquare, useShapeDraw } from './useShapeDraw';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useShapeDraw', () => {
  let host: HTMLDivElement;
  let root: Root;
  let hook: ReturnType<typeof useShapeDraw>;

  const Probe = () => {
    hook = useShapeDraw({
      activeTool: 'shape-rect',
      screenToCanvas: (x, y) => ({ x, y }),
      getContainer: () => host,
      addNode: vi.fn(),
      updateNode: vi.fn(),
      onCommitted: vi.fn(),
    });
    return null;
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('cancels a draft without consuming the Escape needed to exit shape mode', () => {
    act(() => {
      hook.handleOverlayMouseDown({
        button: 0,
        clientX: 10,
        clientY: 20,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent);
    });
    expect(hook.draft).not.toBeNull();

    const bubbleHandler = vi.fn();
    window.addEventListener('keydown', bubbleHandler);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }));
    });
    window.removeEventListener('keydown', bubbleHandler);

    expect(hook.draft).toBeNull();
    expect(bubbleHandler).toHaveBeenCalledOnce();
  });

  it('draws a square while Shift is held, and frees it on release', () => {
    act(() => {
      hook.handleOverlayMouseDown({
        button: 0,
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, clientY: 130, shiftKey: true }));
    });
    expect(hook.draft?.current).toEqual({ x: 180, y: 180 });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', shiftKey: false }));
    });
    expect(hook.draft?.current).toEqual({ x: 180, y: 130 });
  });
});

describe('constrainToSquare', () => {
  it('keeps the drag direction in every quadrant', () => {
    const start = { x: 0, y: 0 };
    expect(constrainToSquare(start, { x: 30, y: -10 })).toEqual({ x: 30, y: -30 });
    expect(constrainToSquare(start, { x: -5, y: -40 })).toEqual({ x: -40, y: -40 });
  });
});
