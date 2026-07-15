// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasEdge } from '../types';
import { useEdgeInteraction } from './useEdgeInteraction';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useEdgeInteraction move gestures', () => {
  let root: Root;
  let host: HTMLElement;
  let hook: ReturnType<typeof useEdgeInteraction>;
  let updateEdge: ReturnType<typeof vi.fn>;
  let commitHistory: ReturnType<typeof vi.fn>;
  let edges: CanvasEdge[];

  const Probe = () => {
    hook = useEdgeInteraction({
      nodes: [],
      sortedNodes: [],
      screenToCanvas: (x, y) => ({ x, y }),
      getContainer: () => host,
      addEdge: (edge) => edge,
      updateEdge,
      commitHistory,
      edges,
    });
    return null;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    updateEdge = vi.fn();
    commitHistory = vi.fn();
    edges = [{
      id: 'edge-1',
      source: { kind: 'point', x: 0, y: 0 },
      target: { kind: 'point', x: 100, y: 50 },
      bend: 0,
    }];
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

  const move = (...points: Array<[number, number]>) => {
    act(() => {
      for (const [clientX, clientY] of points) {
        window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }));
      }
      vi.runOnlyPendingTimers();
    });
  };

  const mouseUp = () => {
    act(() => window.dispatchEvent(new MouseEvent('mouseup')));
  };

  it('keeps repeated whole-edge moves ephemeral and writes the final endpoints once on mouseup', () => {
    act(() => hook.beginMoveEdge('edge-1', 10, 10));

    act(() => {
      for (const [clientX, clientY] of [[20, 25], [35, 45], [60, 70]]) {
        window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }));
      }
    });

    expect(updateEdge).not.toHaveBeenCalled();
    expect(hook.state).toMatchObject({
      kind: 'move-edge',
      cursor: { x: 10, y: 10 },
      previewPatch: {},
    });

    act(() => vi.runOnlyPendingTimers());
    expect(hook.state).toMatchObject({
      kind: 'move-edge',
      cursor: { x: 60, y: 70 },
      previewPatch: {
        source: { kind: 'point', x: 50, y: 60 },
        target: { kind: 'point', x: 150, y: 110 },
      },
    });

    mouseUp();

    expect(updateEdge).toHaveBeenCalledTimes(1);
    expect(updateEdge).toHaveBeenCalledWith('edge-1', {
      source: { kind: 'point', x: 50, y: 60 },
      target: { kind: 'point', x: 150, y: 110 },
    });
    expect(commitHistory).not.toHaveBeenCalled();
  });

  it('commits the latest pointer position when mouseup arrives before the pending frame', () => {
    act(() => hook.beginMoveEdge('edge-1', 10, 10));
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 45, clientY: 55 }));
    });

    expect(updateEdge).not.toHaveBeenCalled();
    mouseUp();

    expect(updateEdge).toHaveBeenCalledTimes(1);
    expect(updateEdge).toHaveBeenCalledWith('edge-1', {
      source: { kind: 'point', x: 35, y: 45 },
      target: { kind: 'point', x: 135, y: 95 },
    });
  });

  it('keeps endpoint geometry ephemeral and commits only its latest position', () => {
    act(() => hook.beginMoveEnd('edge-1', 'target', 100, 50));

    move([120, 70], [145, 95]);

    expect(updateEdge).not.toHaveBeenCalled();
    expect(hook.state).toMatchObject({
      kind: 'move-end',
      cursor: { x: 145, y: 95 },
      previewPatch: { target: { kind: 'point', x: 145, y: 95 } },
    });

    mouseUp();
    expect(updateEdge).toHaveBeenCalledTimes(1);
    expect(updateEdge).toHaveBeenCalledWith('edge-1', {
      target: { kind: 'point', x: 145, y: 95 },
    });
  });

  it('keeps bend geometry ephemeral and commits the final bend once', () => {
    act(() => hook.beginMoveBend('edge-1', { x: 0, y: 0 }, { x: 100, y: 0 }, 50, 0));

    move([50, 10], [50, 30]);

    expect(updateEdge).not.toHaveBeenCalled();
    expect(hook.state).toMatchObject({
      kind: 'move-bend',
      cursor: { x: 50, y: 30 },
      previewPatch: { bend: -30 },
    });

    mouseUp();
    expect(updateEdge).toHaveBeenCalledTimes(1);
    expect(updateEdge).toHaveBeenCalledWith('edge-1', { bend: -30 });
  });

  it('drops an ephemeral move on Escape without writing or committing history', () => {
    act(() => hook.beginMoveEdge('edge-1', 10, 10));
    move([30, 40], [50, 60]);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(updateEdge).not.toHaveBeenCalled();
    expect(commitHistory).not.toHaveBeenCalled();
    expect(hook.state).toBeNull();
  });

  it('does not start a whole-edge move when both endpoints are node-bound', () => {
    edges = [{
      id: 'edge-1',
      source: { kind: 'node', nodeId: 'node-a', anchor: 'auto' },
      target: { kind: 'node', nodeId: 'node-b', anchor: 'auto' },
    }];
    act(() => root.render(<Probe />));

    act(() => hook.beginMoveEdge('edge-1', 10, 10));

    expect(hook.state).toBeNull();
    move([50, 60]);
    mouseUp();
    expect(updateEdge).not.toHaveBeenCalled();
    expect(commitHistory).not.toHaveBeenCalled();
  });
});
