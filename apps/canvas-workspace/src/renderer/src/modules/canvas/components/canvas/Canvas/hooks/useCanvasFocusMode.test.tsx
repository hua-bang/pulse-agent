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

  it('steps across focusable nodes and restores the original viewport on exit', () => {
    const { api, animateTransform, setSelectedNodeIds, root } = mount();

    expect(api().canStepFullscreen).toBe(true);
    act(() => api().stepFullscreen(1));

    expect(api().fullscreenNodeId).toBe('b');
    expect(setSelectedNodeIds).toHaveBeenCalledWith(['b']);
    expect(animateTransform).toHaveBeenLastCalledWith({ x: -800, y: -0, scale: 1 });

    // Exiting via toggleFocusMode restores the initial overview captured on entry.
    act(() => api().toggleFocusMode());
    expect(api().fullscreenNodeId).toBeNull();
    expect(animateTransform).toHaveBeenLastCalledWith({ x: 10, y: 20, scale: 0.5 });
    act(() => root.unmount());
  });
});

describe('unified toggleFocusMode', () => {
  it('enters immersive focus for a selected content node and tightly frames a frame node', () => {
    const fileNode = node('file-1', 100);
    const frameNode = {
      id: 'frame-1', type: 'frame', title: 'Frame', x: 500, y: 0, width: 600, height: 400, data: {},
    } as CanvasNode;
    const nodes = [fileNode, frameNode];
    const handleFocusNode = vi.fn();
    const animateTransform = vi.fn();
    let selected = ['file-1'];
    let api!: ReturnType<typeof useCanvasFocusMode>;
    const Probe = () => {
      api = useCanvasFocusMode({
        nodes,
        nodesById: new Map(nodes.map((n) => [n.id, n])),
        nodesRef: { current: nodes },
        selectedNodeIds: selected,
        handleFocusNode,
        getLiveTransform: () => ({ x: 0, y: 0, scale: 0.8 }),
        animateTransform,
        setSelectedNodeIds: vi.fn(),
        setSelectedEdgeId: vi.fn(),
        setHighlightedId: vi.fn(),
      });
      return null;
    };
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));

    act(() => api.toggleFocusMode());
    expect(api.fullscreenNodeId).toBe('file-1');
    expect(api.focusModeActive).toBe(true);

    act(() => api.toggleFocusMode());
    expect(api.fullscreenNodeId).toBeNull();

    selected = ['frame-1'];
    act(() => root.render(<Probe />));
    act(() => api.toggleFocusMode());
    expect(api.fullscreenNodeId).toBeNull();
    expect(handleFocusNode).toHaveBeenCalledWith(frameNode, { padding: 40, maxScale: 1.5 });
    act(() => root.unmount());
  });
});
