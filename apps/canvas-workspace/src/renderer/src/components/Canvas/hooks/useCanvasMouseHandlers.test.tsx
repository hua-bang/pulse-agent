// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCanvasInteractionShieldState,
  useCanvasMouseHandlers,
} from './useCanvasMouseHandlers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('canvas interaction shield selection', () => {
  it('uses one global shield for canvas movement without creating per-iframe shields', () => {
    expect(getCanvasInteractionShieldState({
      activeTool: 'select',
      directInteractionActive: false,
      moving: true,
    })).toEqual({
      iframeShieldActive: false,
      interactionShieldActive: true,
      motionShieldOnly: true,
    });
  });

  it('keeps per-iframe shields for direct pointer interactions', () => {
    expect(getCanvasInteractionShieldState({
      activeTool: 'select',
      directInteractionActive: true,
      moving: false,
    })).toEqual({
      iframeShieldActive: true,
      interactionShieldActive: true,
      motionShieldOnly: false,
    });
  });

  it('keeps per-iframe shields while the hand tool is idle', () => {
    expect(getCanvasInteractionShieldState({
      activeTool: 'hand',
      directInteractionActive: false,
      moving: false,
    })).toEqual({
      iframeShieldActive: true,
      interactionShieldActive: false,
      motionShieldOnly: false,
    });
  });
});

describe('useCanvasMouseHandlers resize completion', () => {
  let root: Root;
  let host: HTMLElement;
  let hook: ReturnType<typeof useCanvasMouseHandlers>;
  let onResizeMove = vi.fn(() => true);
  let onResizeEnd = vi.fn(() => true);
  let commitHistory: ReturnType<typeof vi.fn>;
  let onNodesChange: ReturnType<typeof vi.fn>;
  let suppressBlankClickRef: { current: boolean };

  const Probe = () => {
    hook = useCanvasMouseHandlers({
      canvasId: 'canvas-1',
      activeTool: 'select',
      containerRef: { current: null },
      suppressBlankClickRef,
      setSelectedNodeIds: vi.fn(),
      setSelectedEdgeId: vi.fn(),
      contextMenu: null,
      closeContextMenu: vi.fn(),
      isBlankCanvasTarget: () => true,
      canvasMouseDown: vi.fn(),
      canvasMouseMove: vi.fn(),
      canvasMouseUp: vi.fn(),
      moving: false,
      panning: false,
      onDragStart: vi.fn(),
      onDragMove: vi.fn(() => false),
      onDragEnd: vi.fn(),
      onDragCancel: vi.fn(),
      onResizeCancel: vi.fn(),
      resizingId: 'node-1',
      onResizeStart: vi.fn(),
      onResizeMove,
      onResizeEnd,
      edgeInteractionState: null,
      marquee: { active: false, begin: vi.fn() },
      shapeToolActive: false,
      shapeDraft: null,
      commitHistory,
      onNodesChange,
    });
    return null;
  };

  beforeEach(() => {
    onResizeMove = vi.fn(() => true);
    onResizeEnd = vi.fn(() => true);
    commitHistory = vi.fn();
    onNodesChange = vi.fn();
    suppressBlankClickRef = { current: false };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const startResize = () => {
    act(() => {
      hook.handleSurfaceResizeStart(
        { button: 0 } as React.MouseEvent,
        'node-1',
        300,
        200,
        'bottom-right',
      );
    });
  };

  const moveWindowPointer = () => {
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 130 }));
    });
  };

  it('suppresses the trailing blank click when a moved resize returns to its origin', () => {
    onResizeMove.mockReturnValueOnce(true).mockReturnValue(false);
    onResizeEnd.mockReturnValue(false);
    startResize();
    moveWindowPointer();
    moveWindowPointer();

    act(() => hook.handleMouseUp());

    expect(suppressBlankClickRef.current).toBe(true);
    expect(commitHistory).not.toHaveBeenCalled();
    expect(onNodesChange).not.toHaveBeenCalled();
  });

  it('does not emit stale parent nodes before an ephemeral resize commit renders', () => {
    startResize();
    moveWindowPointer();

    act(() => hook.handleMouseUp());

    expect(commitHistory).toHaveBeenCalledTimes(1);
    expect(onNodesChange).not.toHaveBeenCalled();
  });
});

describe('useCanvasMouseHandlers synchronous drag shield', () => {
  let root: Root;
  let host: HTMLElement;
  let container: HTMLDivElement;
  let hook: ReturnType<typeof useCanvasMouseHandlers>;

  /** happy-dom's native MouseEvent does not set defaultPrevented after
   *  preventDefault, so we use a plain object with the two always in sync. */
  const dragEvent = (altKey = false): React.MouseEvent => {
    const e: any = { button: 0, altKey, defaultPrevented: false };
    e.preventDefault = () => { e.defaultPrevented = true; };
    e.stopPropagation = vi.fn();
    return e as React.MouseEvent;
  };

  const findShield = () => container.querySelector('.canvas-interaction-shield');

  const Probe = () => {
    hook = useCanvasMouseHandlers({
      canvasId: 'canvas-1',
      activeTool: 'select',
      containerRef: { current: container },
      suppressBlankClickRef: { current: false },
      setSelectedNodeIds: vi.fn(),
      setSelectedEdgeId: vi.fn(),
      contextMenu: null,
      closeContextMenu: vi.fn(),
      isBlankCanvasTarget: () => true,
      canvasMouseDown: vi.fn(),
      canvasMouseMove: vi.fn(),
      canvasMouseUp: vi.fn(),
      moving: false,
      panning: false,
      onDragStart: vi.fn((e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); }),
      onDragMove: vi.fn(() => false),
      onDragEnd: vi.fn(),
      onDragCancel: vi.fn(),
      onResizeCancel: vi.fn(),
      resizingId: null,
      onResizeStart: vi.fn(),
      onResizeMove: vi.fn(() => false),
      onResizeEnd: vi.fn(() => false),
      edgeInteractionState: null,
      marquee: { active: false, begin: vi.fn() },
      shapeToolActive: false,
      shapeDraft: null,
      commitHistory: vi.fn(),
      onNodesChange: vi.fn(),
    });
    return null;
  };

  beforeEach(() => {
    host = document.createElement('div');
    container = document.createElement('div');
    host.appendChild(container);
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('mounts the interaction shield synchronously on drag mousedown', () => {
    expect(findShield()).toBeNull();
    act(() => {
      hook.handleSurfaceDragStart(dragEvent(), { id: 'node-1', x: 0, y: 0, width: 200, height: 100 } as any);
    });
    expect(findShield()).not.toBeNull();
  });

  it('mounts the shield on resize mousedown too', () => {
    act(() => {
      hook.handleSurfaceResizeStart(dragEvent(), 'node-1', 300, 200, 'bottom-right');
    });
    expect(findShield()).not.toBeNull();
  });

  it('removes the shield on mouseup', () => {
    act(() => {
      hook.handleSurfaceDragStart(dragEvent(), { id: 'node-1', x: 0, y: 0, width: 200, height: 100 } as any);
    });
    expect(findShield()).not.toBeNull();
    act(() => hook.handleMouseUp());
    expect(findShield()).toBeNull();
  });

  it('removes the shield on Escape', () => {
    act(() => {
      hook.handleSurfaceDragStart(dragEvent(), { id: 'node-1', x: 0, y: 0, width: 200, height: 100 } as any);
    });
    expect(findShield()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(findShield()).toBeNull();
  });

  it('does not mount the shield on alt-drag (pan gesture)', () => {
    act(() => {
      hook.handleSurfaceDragStart(dragEvent(true), { id: 'node-1', x: 0, y: 0, width: 200, height: 100 } as any);
    });
    expect(findShield()).toBeNull();
  });

  it('does not double-mount when drag start fires twice', () => {
    act(() => {
      hook.handleSurfaceDragStart(dragEvent(), { id: 'node-1', x: 0, y: 0, width: 200, height: 100 } as any);
      hook.handleSurfaceResizeStart(dragEvent(), 'node-1', 300, 200, 'bottom-right');
    });
    expect(container.querySelectorAll('.canvas-interaction-shield').length).toBe(1);
  });
});
