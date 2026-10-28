// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasNode, CanvasTransform } from '../../../../../../types';
import { useCanvasFocusMode } from './useCanvasFocusMode';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const node = (id: string, x: number): CanvasNode => ({
  id, type: 'file', title: id, x, y: 0, width: 400, height: 300, data: {},
} as CanvasNode);

describe('navigation while a node is fullscreen', () => {
  const mount = () => {
    const nodes = [node('a', 0), node('b', 800)];
    const handleFocusNode = vi.fn();
    const animateTransform = vi.fn((_next: CanvasTransform) => {});
    const setSelectedNodeIds = vi.fn();
    let api!: ReturnType<typeof useCanvasFocusMode>;
    const Probe = () => {
      api = useCanvasFocusMode({
        nodes,
        nodesById: new Map(nodes.map((n) => [n.id, n])),
        nodesRef: { current: nodes },
        selectedNodeIds: [],
        handleFocusNode,
        getLiveTransform: () => ({ x: 10, y: 20, scale: 0.5 }),
        animateTransform,
        setSelectedNodeIds,
        setSelectedEdgeId: vi.fn(),
        setHighlightedId: vi.fn(),
      });
      return null;
    };
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
    act(() => api.handleToggleFullscreen('a'));
    animateTransform.mockClear();
    return { api: () => api, handleFocusNode, animateTransform, setSelectedNodeIds, root };
  };

  it('keeps the camera when the fullscreen node itself is focused', () => {
    const { api, handleFocusNode, animateTransform, setSelectedNodeIds, root } = mount();

    act(() => api().focusNodeInViewport(node('a', 0)));

    expect(setSelectedNodeIds).toHaveBeenCalledWith(['a']);
    expect(api().fullscreenNodeId).toBe('a');
    expect(handleFocusNode).not.toHaveBeenCalled();
    expect(animateTransform).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('ends fullscreen without the return glide before framing another node', () => {
    const { api, handleFocusNode, animateTransform, root } = mount();

    act(() => api().focusNodeInViewport(node('b', 800)));

    expect(api().fullscreenNodeId).toBeNull();
    expect(handleFocusNode).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }), expect.any(Object));
    // The return glide would override the new framing.
    expect(animateTransform).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
