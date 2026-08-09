// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../types';
import { shouldPersistViewportTransform, useCanvasSyncEffects } from './useCanvasSyncEffects';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('shouldPersistViewportTransform', () => {
  it('does not persist before the canvas has loaded', () => {
    expect(shouldPersistViewportTransform(false, false)).toBe(false);
  });

  it('defers viewport persistence while pan or zoom is moving', () => {
    expect(shouldPersistViewportTransform(true, true)).toBe(false);
  });

  it('persists the settled viewport once the gesture is idle', () => {
    expect(shouldPersistViewportTransform(true, false)).toBe(true);
  });
});

describe('useCanvasSyncEffects', () => {
  it('routes an external node focus request through the public viewport-focus callback', () => {
    const node: CanvasNode = {
      id: 'node-1',
      type: 'text',
      title: 'Focused node',
      x: 10,
      y: 20,
      width: 240,
      height: 120,
      data: {},
      updatedAt: 1,
    };
    const handleNodeViewportFocus = vi.fn();
    const onFocusComplete = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const Harness = () => {
      useCanvasSyncEffects({
        canvasId: 'canvas-1',
        loaded: true,
        nodes: [node],
        transform: { x: 0, y: 0, scale: 1 },
        selectedNodeIds: [],
        nodesRef: { current: [node] },
        isDraggingRef: { current: false },
        pendingParentNodesRef: { current: null },
        hasAutoFittedRef: { current: true },
        setTransformForSave: vi.fn(),
        flushSave: vi.fn(),
        fitAllNodes: vi.fn(),
        handleNodeViewportFocus,
        updateNode: vi.fn(),
        handleExternalDelete: vi.fn(),
        focusNodeId: node.id,
        onFocusComplete,
      });
      return null;
    };

    act(() => root.render(createElement(Harness)));

    expect(handleNodeViewportFocus).toHaveBeenCalledWith(node);
    expect(onFocusComplete).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    host.remove();
  });
});
