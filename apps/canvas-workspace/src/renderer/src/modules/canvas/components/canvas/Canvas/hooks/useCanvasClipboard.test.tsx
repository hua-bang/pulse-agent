// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../../../../../../types';
import type { CanvasClipboard } from '../../../../../../types/ui-interaction';
import { useCanvasClipboard } from './useCanvasClipboard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node = (id: string, content?: string): CanvasNode => ({
  id, type: 'text', title: id, x: 0, y: 0, width: 240, height: 120,
  data: (content === undefined ? {} : { content }) as CanvasNode['data'],
});

const edge = (id: string, from: string, to: string): CanvasEdge => ({
  id, source: { kind: 'node', nodeId: from }, target: { kind: 'node', nodeId: to },
});

describe('useCanvasClipboard', () => {
  let host: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof useCanvasClipboard>;
  let clipboard: CanvasClipboard | null;
  const containerRef = createRef<HTMLDivElement>() as { current: HTMLDivElement | null };
  const setClipboard = vi.fn((next: CanvasClipboard | null) => { clipboard = next; });
  const pasteNodes = vi.fn((nodes: CanvasNode[]) => nodes.map((source) => ({ ...source, id: `${source.id}-copy` })));
  const removeNodes = vi.fn();
  const pasteReferenceNodes = vi.fn(() => [] as CanvasNode[]);
  let canvasId = 'canvas-1';
  const setSelectedNodeIds = vi.fn();

  const Probe = ({ nodes, edges, selected }: { nodes: CanvasNode[]; edges: CanvasEdge[]; selected: string[] }) => {
    api = useCanvasClipboard({
      canvasId, clipboard, setClipboard, nodes, edges,
      selectedNodeIds: selected, setSelectedNodeIds, containerRef,
      screenToCanvas: (x, y) => ({ x: x * 2, y: y * 2 }),
      pasteNodes, pasteReferenceNodes, removeNodes,
    });
    return null;
  };

  const mount = (nodes: CanvasNode[], selected: string[], edges: CanvasEdge[] = []) => {
    const render = () => act(() => root.render(<Probe nodes={nodes} edges={edges} selected={selected} />));
    render();
    return render;
  };

  beforeEach(() => {
    clipboard = null;
    canvasId = 'canvas-1';
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    containerRef.current = host;
    root = createRoot(document.createElement('div'));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('mirrors a canvas copy into the system clipboard so paste can compare', () => {
    mount([node('node-1')], ['node-1']);
    act(() => { api.copy(); });
    expect(setClipboard).toHaveBeenCalledWith(expect.objectContaining({
      sourceWorkspaceId: 'canvas-1',
      systemText: 'node-1',
    }));
  });

  it('copies text-node prose, not placeholder titles, to the system clipboard', () => {
    mount([
      { ...node('a', '<p>First &amp; one</p><p>line two</p>'), title: 'Text' },
      { ...node('b', '<p>Second</p>'), title: 'Text' },
    ], ['a', 'b']);
    act(() => { api.copy(); });
    expect(setClipboard).toHaveBeenCalledWith(expect.objectContaining({
      systemText: 'First & one\nline two\n\nSecond',
    }));
  });

  it('copies only the edges between the copied nodes', () => {
    mount([node('a'), node('b'), node('c')], ['a', 'b'], [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')]);
    act(() => { api.copy(); });
    expect(clipboard?.edges?.map((item) => item.id)).toEqual(['ab']);
  });

  it('cuts: copies the selection, then removes it', () => {
    mount([node('a'), node('b')], ['a']);
    act(() => { api.cut(); });
    expect(clipboard?.nodes.map((item) => item.id)).toEqual(['a']);
    expect(removeNodes).toHaveBeenCalledWith(['a'], { recoverable: true });
  });

  it('cuts a container with its contents, so a paste does not duplicate them', () => {
    const frame = { ...node('frame'), type: 'frame', width: 600, height: 400 } as CanvasNode;
    const child = { ...node('child'), x: 40, y: 40 };
    mount([frame, child], ['frame']);
    act(() => { api.cut(); });
    expect(removeNodes).toHaveBeenCalledWith(['frame', 'child'], { recoverable: true });
  });

  it('pastes real nodes, not references, when a cut moves to another workspace', () => {
    const render = mount([node('a')], ['a']);
    act(() => { api.cut(); });
    canvasId = 'canvas-2';
    render();
    act(() => { api.paste(''); });
    expect(pasteReferenceNodes).not.toHaveBeenCalled();
    expect(pasteNodes).toHaveBeenCalledTimes(1);
  });

  it('pastes references when a copy moves to another workspace', () => {
    const render = mount([node('a')], ['a']);
    act(() => { api.copy(); });
    canvasId = 'canvas-2';
    render();
    act(() => { api.paste(''); });
    expect(pasteReferenceNodes).toHaveBeenCalledTimes(1);
    expect(pasteNodes).not.toHaveBeenCalled();
  });

  it('does not cut an empty selection', () => {
    mount([node('a')], []);
    act(() => { api.cut(); });
    expect(removeNodes).not.toHaveBeenCalled();
  });

  it('pastes on the pointer, and steps away when the same point repeats', () => {
    const render = mount([node('a')], ['a']);
    act(() => { api.copy(); });
    render();
    document.elementFromPoint = () => host;
    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 50 })); });

    act(() => { api.paste(''); });
    act(() => { api.paste(''); });

    expect(pasteNodes.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      { edges: [], at: { x: 200, y: 100 } },
      { edges: [], at: { x: 224, y: 124 } },
    ]);
    expect(setSelectedNodeIds).toHaveBeenLastCalledWith(['a-copy']);
  });

  it('keeps the source offset when the pointer is outside the canvas', () => {
    const render = mount([node('a')], ['a']);
    act(() => { api.copy(); });
    render();
    document.elementFromPoint = () => document.body;
    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 50 })); });

    act(() => { api.paste(''); });

    expect((pasteNodes.mock.calls[0] as unknown[])[1]).toEqual({ edges: [], at: undefined });
  });

  it('lets a newer system copy win over the canvas clipboard', () => {
    const render = mount([node('a')], ['a']);
    act(() => { api.copy(); });
    render();
    let consumed = true;
    act(() => { consumed = api.paste('text copied in another app'); });
    expect(consumed).toBe(false);
    expect(pasteNodes).not.toHaveBeenCalled();
  });
});
