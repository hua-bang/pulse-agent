import { describe, expect, it } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../types';
import { canvasEdgesLayerPropsAreEqual, type CanvasEdgesLayerProps } from './CanvasEdgesLayer';

/**
 * Guards the memo comparator added after measuring (isolated Profiler
 * harness, 100 nodes + 100 edges, a 50-tick pan/zoom wheel burst) that
 * every parent re-render — including a pure pan/zoom transform change that
 * touches neither edges nor nodes — forced this component to reconcile its
 * full SVG subtree: 100 edges cost ~2.2ms/commit vs ~0.5ms/commit at 0
 * edges (3.5x more total main-thread time across the burst). After the
 * memo, both were ~equal (~0.5ms/commit) since the parent-driven re-render
 * is skipped entirely when this component's own data props haven't
 * changed.
 *
 * Tested directly against the exported comparator function rather than by
 * counting React re-renders through a Profiler — React's Profiler fires
 * onRender for every commit that reaches its position in the tree
 * regardless of whether a memoized child below it actually bails out, so
 * it can't distinguish "the memo worked" from "it didn't" without relying
 * on undocumented internals. The comparator itself is the actual bail-out
 * decision `memo()` calls, so testing it directly is both simpler and
 * exhaustive.
 */

const nodes: CanvasNode[] = [
  { id: 'a', type: 'text', title: 'A', x: 0, y: 0, width: 100, height: 60, data: { text: 'a' } } as CanvasNode,
  { id: 'b', type: 'text', title: 'B', x: 200, y: 0, width: 100, height: 60, data: { text: 'b' } } as CanvasNode,
];

const edges: CanvasEdge[] = [
  { id: 'e1', source: { kind: 'node', nodeId: 'a' }, target: { kind: 'node', nodeId: 'b' } },
];

const baseProps: CanvasEdgesLayerProps = {
  edges,
  nodes,
  selectedEdgeId: null,
};

describe('canvasEdgesLayerPropsAreEqual', () => {
  it('treats identical data props as equal even with fresh handler closures', () => {
    const prev: CanvasEdgesLayerProps = { ...baseProps, onSelectEdge: (id) => { void id; } };
    const next: CanvasEdgesLayerProps = { ...baseProps, onSelectEdge: (id) => { void id; } };
    expect(prev.onSelectEdge).not.toBe(next.onSelectEdge);
    expect(canvasEdgesLayerPropsAreEqual(prev, next)).toBe(true);
  });

  it('treats a pure transform-driven parent re-render (no data prop changes) as equal', () => {
    // Mirrors the actual CanvasSurface usage: edges/nodes/selection are
    // passed straight through from props, so their references genuinely
    // don't change on a wheel tick.
    expect(canvasEdgesLayerPropsAreEqual(baseProps, baseProps)).toBe(true);
  });

  it('detects a real edges change', () => {
    const next: CanvasEdgesLayerProps = { ...baseProps, edges: [...edges] };
    expect(canvasEdgesLayerPropsAreEqual(baseProps, next)).toBe(false);
  });

  it('detects a real nodes change', () => {
    const next: CanvasEdgesLayerProps = { ...baseProps, nodes: [...nodes] };
    expect(canvasEdgesLayerPropsAreEqual(baseProps, next)).toBe(false);
  });

  it('detects a selection change', () => {
    const next: CanvasEdgesLayerProps = { ...baseProps, selectedEdgeId: 'e1' };
    expect(canvasEdgesLayerPropsAreEqual(baseProps, next)).toBe(false);
  });

  it('detects an interaction-state change', () => {
    const next: CanvasEdgesLayerProps = {
      ...baseProps,
      interactionState: {
        kind: 'connect',
        source: { kind: 'node', nodeId: 'a' },
        cursor: { x: 0, y: 0 },
        hoverNodeId: null,
        distance: 0,
      },
    };
    expect(canvasEdgesLayerPropsAreEqual(baseProps, next)).toBe(false);
  });

  it('detects a focus-mode toggle', () => {
    const next: CanvasEdgesLayerProps = { ...baseProps, focusModeEnabled: true };
    expect(canvasEdgesLayerPropsAreEqual(baseProps, next)).toBe(false);
  });
});
