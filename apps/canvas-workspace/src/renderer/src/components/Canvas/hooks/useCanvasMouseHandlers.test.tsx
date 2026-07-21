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

  describe('nodeGesturePending', () => {
    it('activates iframe shielding but NOT the full-screen interaction shield on pending drag', () => {
      // mousedown-on-node fired, pointer hasn't moved yet — shield iframes
      // immediately so a webview guest can't swallow the first mousemove,
      // but don't mount the full-screen overlay (it would break dblclick).
      expect(getCanvasInteractionShieldState({
        activeTool: 'select',
        directInteractionActive: false,
        moving: false,
        nodeGesturePending: true,
      })).toEqual({
        iframeShieldActive: true,
        interactionShieldActive: false,
        motionShieldOnly: false,
      });
    });

    it('iframe shielding stays active after motion commits the gesture (nodeGestureActive takes over)', () => {
      // Once the pointer moves past the threshold, nodeGestureActive flips
      // and the interaction shield mounts. nodeGesturePending is still set
      // (it clears on mouseup), but the shield should stay active either way.
      expect(getCanvasInteractionShieldState({
        activeTool: 'select',
        directInteractionActive: true,
        moving: false,
        nodeGesturePending: true,
      })).toEqual({
        iframeShieldActive: true,
        interactionShieldActive: true,
        motionShieldOnly: false,
      });
    });

    it('nodeGesturePending alone is not enough for a full interaction shield', () => {
      // Guarantee that a bare click (no motion) never mounts the z-index
      // 1800 overlay — that's what protects double-click from being broken.
      expect(getCanvasInteractionShieldState({
        activeTool: 'select',
        directInteractionActive: false,
        moving: false,
        nodeGesturePending: true,
      }).interactionShieldActive).toBe(false);
    });

    it('nodeGesturePending defaults to false (backward compatible)', () => {
      // Callers that don't pass the param must see the same behavior as before.
      expect(getCanvasInteractionShieldState({
        activeTool: 'select',
        directInteractionActive: false,
        moving: false,
      })).toEqual({
        iframeShieldActive: false,
        interactionShieldActive: false,
        motionShieldOnly: false,
      });
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
