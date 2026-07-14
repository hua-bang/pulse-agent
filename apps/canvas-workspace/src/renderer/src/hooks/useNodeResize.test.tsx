// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../types';
import {
  applyNodeResizePreview,
  applyResizePreviewToNodes,
  computeNodeResizeGeometry,
  useNodeResize,
  type NodeResizeOrigin,
  type ResizeEdge,
} from './useNodeResize';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const origin: NodeResizeOrigin = {
  id: 'node-1',
  startPointerX: 100,
  startPointerY: 100,
  startWidth: 300,
  startHeight: 200,
  startNodeX: 10,
  startNodeY: 20,
  minWidth: 100,
  minHeight: 80,
  edge: 'right',
};

describe('computeNodeResizeGeometry', () => {
  it.each([
    ['right', { x: 10, y: 20, width: 340, height: 200 }],
    ['bottom', { x: 10, y: 20, width: 300, height: 230 }],
    ['bottom-right', { x: 10, y: 20, width: 340, height: 230 }],
    ['left', { x: 50, y: 20, width: 260, height: 200 }],
    ['top', { x: 10, y: 50, width: 300, height: 170 }],
    ['top-left', { x: 50, y: 50, width: 260, height: 170 }],
    ['top-right', { x: 10, y: 50, width: 340, height: 170 }],
    ['bottom-left', { x: 50, y: 20, width: 260, height: 230 }],
  ] satisfies Array<[ResizeEdge, { x: number; y: number; width: number; height: number }]>) (
    'computes %s geometry in canvas coordinates',
    (edge, expected) => {
      expect(computeNodeResizeGeometry({ ...origin, edge }, 180, 160, 2)).toEqual({
        id: 'node-1',
        edge,
        ...expected,
      });
    },
  );

  it('keeps the opposite edges anchored when minimum size clamps left/top movement', () => {
    expect(computeNodeResizeGeometry({ ...origin, edge: 'top-left' }, 2100, 2100, 1)).toEqual({
      id: 'node-1',
      edge: 'top-left',
      x: 210,
      y: 140,
      width: 100,
      height: 80,
    });
  });
});

describe('applyNodeResizePreview', () => {
  const node = {
    id: 'node-1',
    type: 'iframe',
    title: 'Node',
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    data: { mode: 'html', html: '' },
    updatedAt: 1,
  } as CanvasNode;

  it('projects live geometry into only the resized node', () => {
    const preview = {
      id: 'node-1',
      edge: 'top-left' as const,
      x: 40,
      y: 50,
      width: 270,
      height: 170,
    };

    expect(applyNodeResizePreview(node, preview)).toEqual({ ...node, x: 40, y: 50, width: 270, height: 170 });
  });

  it('preserves object identity for nodes outside the active resize', () => {
    const preview = {
      id: 'another-node',
      edge: 'right' as const,
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    };

    expect(applyNodeResizePreview(node, preview)).toBe(node);
    expect(applyNodeResizePreview(node, null)).toBe(node);
  });

  it('projects the preview into the edge-layer node list while preserving other node identities', () => {
    const other = { ...node, id: 'node-2' };
    const preview = {
      id: 'node-1',
      edge: 'left' as const,
      x: 40,
      y: 20,
      width: 270,
      height: 200,
    };

    const nodes = [node, other];
    const projected = applyResizePreviewToNodes(nodes, preview);
    expect(projected).not.toBe(nodes);
    expect(projected[0]).toEqual({ ...node, x: 40, width: 270 });
    expect(projected[1]).toBe(other);
    expect(applyResizePreviewToNodes(nodes, null)).toBe(nodes);
  });

  it('disables text auto-size only in the ephemeral preview projection', () => {
    const textNode = {
      id: 'text-1',
      type: 'text',
      title: 'Text',
      x: 10,
      y: 20,
      width: 240,
      height: 100,
      data: { content: 'hello', autoSize: true },
      updatedAt: 1,
    } as CanvasNode;
    const preview = {
      id: 'text-1',
      edge: 'right' as const,
      x: 10,
      y: 20,
      width: 320,
      height: 100,
    };

    const projected = applyNodeResizePreview(textNode, preview);

    expect(projected).toMatchObject({
      width: 320,
      data: { content: 'hello', autoSize: false },
    });
    expect(textNode).toMatchObject({
      width: 240,
      data: { content: 'hello', autoSize: true },
    });
  });
});

describe('useNodeResize', () => {
  let root: Root;
  let host: HTMLElement;
  let hook: ReturnType<typeof useNodeResize>;
  let resizeNode: ReturnType<typeof vi.fn>;

  const nodes = [{
    id: 'node-1',
    type: 'iframe',
    title: 'Node',
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    data: { mode: 'html', html: '' },
    updatedAt: 1,
  }] as CanvasNode[];

  const Probe = () => {
    hook = useNodeResize(resizeNode, 1, nodes);
    return null;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    resizeNode = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const start = (edge: ResizeEdge = 'bottom-right') => {
    act(() => {
      hook.onResizeStart({
        button: 0,
        clientX: 100,
        clientY: 100,
        stopPropagation: vi.fn(),
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent, 'node-1', 300, 200, edge, 100, 80);
    });
  };

  const move = (clientX: number, clientY: number) => {
    act(() => {
      hook.onResizeMove({ clientX, clientY } as MouseEvent);
      vi.runOnlyPendingTimers();
    });
  };

  it('keeps move frames ephemeral and commits the final geometry once on mouseup', () => {
    start();
    move(120, 110);
    move(140, 130);
    move(160, 150);

    expect(resizeNode).not.toHaveBeenCalled();
    expect(hook.resizePreview).toEqual({
      id: 'node-1',
      edge: 'bottom-right',
      x: 10,
      y: 20,
      width: 360,
      height: 250,
    });

    act(() => hook.onResizeEnd());

    expect(resizeNode).toHaveBeenCalledTimes(1);
    expect(resizeNode).toHaveBeenCalledWith('node-1', 360, 250, 10, 20);
    expect(hook.resizePreview).toBeNull();
  });

  it('drops ephemeral geometry on cancel without touching the nodes array', () => {
    start('top-left');
    move(140, 130);
    expect(hook.resizePreview).toMatchObject({ x: 50, y: 50, width: 260, height: 170 });

    act(() => hook.onResizeCancel());

    expect(resizeNode).not.toHaveBeenCalled();
    expect(hook.resizingId).toBeNull();
    expect(hook.resizePreview).toBeNull();
  });

  it('commits the latest pointer event once when mouseup beats the pending animation frame', () => {
    start();
    act(() => {
      hook.onResizeMove({ clientX: 155, clientY: 145 } as MouseEvent);
    });

    let committed = false;
    act(() => {
      committed = hook.onResizeEnd();
    });

    expect(committed).toBe(true);
    expect(resizeNode).toHaveBeenCalledTimes(1);
    expect(resizeNode).toHaveBeenCalledWith('node-1', 355, 245, 10, 20);
  });

  it('does not commit when the final geometry equals the resize origin', () => {
    start();
    move(140, 130);
    move(100, 100);

    let committed = true;
    act(() => {
      committed = hook.onResizeEnd();
    });

    expect(committed).toBe(false);
    expect(resizeNode).not.toHaveBeenCalled();
  });
});
