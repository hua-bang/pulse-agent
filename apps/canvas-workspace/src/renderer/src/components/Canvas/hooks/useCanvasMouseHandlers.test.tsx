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
  let guestWebview: HTMLElement;
  let hook: ReturnType<typeof useCanvasMouseHandlers>;

  /** happy-dom's native MouseEvent does not set defaultPrevented after
   *  preventDefault, so we use a plain object with the two always in sync. */
  const dragEvent = (altKey = false): React.MouseEvent => {
    const e: any = { button: 0, altKey, defaultPrevented: false };
    e.preventDefault = () => { e.defaultPrevented = true; };
    e.stopPropagation = vi.fn();
    return e as React.MouseEvent;
  };

  // The shield no longer inserts a DOM node of its own (see
  // utils/interactionShield.ts) — it toggles pointer-events directly on
  // every <webview>/<iframe> guest, so assert on that instead.
  const isShielded = () => guestWebview.style.pointerEvents === 'none';

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
    // A stand-in guest, appended as a sibling of `host` rather than inside
    // it: acquireInteractionShield() queries the whole document for
    // webview/iframe elements (matching a dock link-tab webview, which
    // doesn't live inside the canvas container either), and React's
    // createRoot(host) takes ownership of host's children on first render —
    // anything appended inside host before that render gets wiped.
    guestWebview = document.createElement('webview');
    document.body.appendChild(guestWebview);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    guestWebview.remove();
  });

  it('shields guest elements synchronously on drag mousedown', () => {
    expect(isShielded()).toBe(false);
    act(() => {
      hook.handleSurfaceDragStart(dragEvent(), { id: 'node-1', x: 0, y: 0, width: 200, height: 100 } as any);
    });
    expect(isShielded()).toBe(true);
  });

  it('shields guest elements on resize mousedown too', () => {
    act(() => {
      hook.handleSurfaceResizeStart(dragEvent(), 'node-1', 300, 200, 'bottom-right');
    });
    expect(isShielded()).toBe(true);
  });

  it('unshields guest elements on mouseup', () => {
    act(() => {
      hook.handleSurfaceDragStart(dragEvent(), { id: 'node-1', x: 0, y: 0, width: 200, height: 100 } as any);
    });
    expect(isShielded()).toBe(true);
    act(() => hook.handleMouseUp());
    expect(isShielded()).toBe(false);
  });

  it('unshields guest elements on Escape', () => {
    act(() => {
      hook.handleSurfaceDragStart(dragEvent(), { id: 'node-1', x: 0, y: 0, width: 200, height: 100 } as any);
    });
    expect(isShielded()).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(isShielded()).toBe(false);
  });

  it('does not shield guests on alt-drag (pan gesture)', () => {
    act(() => {
      hook.handleSurfaceDragStart(dragEvent(true), { id: 'node-1', x: 0, y: 0, width: 200, height: 100 } as any);
    });
    expect(isShielded()).toBe(false);
  });

  it('does not double-acquire when drag start fires twice', () => {
    act(() => {
      hook.handleSurfaceDragStart(dragEvent(), { id: 'node-1', x: 0, y: 0, width: 200, height: 100 } as any);
      hook.handleSurfaceResizeStart(dragEvent(), 'node-1', 300, 200, 'bottom-right');
    });
    expect(isShielded()).toBe(true);
    // A single mouseup fully unshields — if the second start had acquired
    // again (refcount 2), one release would leave it still shielded.
    act(() => hook.handleMouseUp());
    expect(isShielded()).toBe(false);
  });

  it('does not swallow a stationary click: guests are unshielded by the time mouseup resolves', () => {
    // Regression test for the exact bug this rewrite fixes: a plain
    // mousedown/mouseup with no motion in between (e.g. one half of a
    // double-click) must not leave any guest — or, in the old
    // full-viewport-div design, an overlay standing in front of the real
    // node — as the mouseup hit-test target.
    act(() => {
      hook.handleSurfaceDragStart(dragEvent(), { id: 'node-1', x: 0, y: 0, width: 200, height: 100 } as any);
    });
    expect(isShielded()).toBe(true);
    act(() => hook.handleMouseUp());
    expect(isShielded()).toBe(false);
    // The guest itself never had its own pointer-events touched beyond the
    // shield's own set/restore, so a real click at its coordinates would
    // resolve normally — nothing host-side is left covering it.
    expect(guestWebview.style.pointerEvents).toBe('');
  });
});
