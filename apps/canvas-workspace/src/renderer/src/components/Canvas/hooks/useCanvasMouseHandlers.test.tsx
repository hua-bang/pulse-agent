// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasMouseHandlers } from './useCanvasMouseHandlers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
