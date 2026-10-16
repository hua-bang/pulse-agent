// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const graphHarness = vi.hoisted(() => ({
  centerAt: vi.fn(), zoom: vi.fn(), zoomToFit: vi.fn(), pause: vi.fn(), resume: vi.fn(), reheat: vi.fn(),
  props: {} as Record<string, unknown>,
}));

vi.mock('react-force-graph-2d', () => {
  const React = require('react');
  const force: Record<string, unknown> = {};
  force.strength = vi.fn(() => force);
  force.distanceMax = vi.fn(() => force);
  force.distance = vi.fn(() => force);
  return {
    default: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      graphHarness.props = props;
      React.useImperativeHandle(ref, () => ({
        centerAt: graphHarness.centerAt,
        zoom: graphHarness.zoom,
        zoomToFit: graphHarness.zoomToFit,
        pauseAnimation: graphHarness.pause,
        resumeAnimation: graphHarness.resume,
        d3Force: vi.fn(() => force),
        d3ReheatSimulation: graphHarness.reheat,
      }));
      return React.createElement('div', { 'data-testid': 'force-graph' });
    }),
  };
});

import { ForceGraphCanvas, type ForceGraphCanvasHandle } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ForceGraphCanvas', () => {
  it('adapts product viewport commands to the force-graph implementation', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const ref = createRef<ForceGraphCanvasHandle>();
    act(() => {
      root.render(
        <ForceGraphCanvas
          ref={ref}
          view={{ graph: { nodes: [], links: [] }, width: 800, height: 600, activeNodeId: null, hoverNodeId: null, highlightedNodeIds: new Set(), highlightedLinkIds: new Set(), showLabels: true, layoutPreset: 'normal' }}
          actions={{ hoverNode: vi.fn(), clickNode: vi.fn(), clearSelection: vi.fn() }}
        />,
      );
    });
    act(() => {
      ref.current?.focusNode({ id: 'node-1', kind: 'node', label: 'One', x: 10, y: 20 });
      ref.current?.setPaused(true);
      ref.current?.zoomToFit();
    });
    expect(graphHarness.centerAt).toHaveBeenCalledWith(10, 20, 520);
    expect(graphHarness.zoom).toHaveBeenCalledWith(2.8, 520);
    expect(graphHarness.pause).toHaveBeenCalledTimes(1);
    expect(graphHarness.zoomToFit).toHaveBeenCalledWith(450, 140);
    // The early fit sees an unsettled cluster; the cap keeps it readable.
    expect(graphHarness.props.maxZoom).toBe(4);
    act(() => root.unmount());
  });
});
