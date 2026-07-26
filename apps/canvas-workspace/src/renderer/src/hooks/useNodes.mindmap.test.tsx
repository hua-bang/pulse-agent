// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanvasEdge,
  CanvasNode,
  MindmapNodeData,
  MindmapTopic,
} from '../types';
import { useNodes } from './useNodes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const topic = (
  id: string,
  text: string,
  children: MindmapTopic[] = [],
): MindmapTopic => ({ id, text, children });

const mindmap = (id: string, root: MindmapTopic, x: number): CanvasNode => ({
  id,
  type: 'mindmap',
  title: root.text,
  x,
  y: 20,
  width: 320,
  height: 180,
  data: { root, layout: 'right', rev: 0 } satisfies MindmapNodeData,
  updatedAt: 1,
});

const source = mindmap(
  'source',
  topic('source-root', 'Source', [topic('branch', 'Branch')]),
  10,
);
const target = mindmap('target', topic('target-root', 'Target'), 500);
const edge: CanvasEdge = {
  id: 'edge-1',
  source: { kind: 'node', nodeId: 'source', anchor: 'right' },
  target: { kind: 'node', nodeId: 'target', anchor: 'left' },
};

describe('useNodes mindmap transactions', () => {
  let root: Root;
  let host: HTMLElement;
  let hook: ReturnType<typeof useNodes>;
  let originalCanvasWorkspace: typeof window.canvasWorkspace;

  const Probe = () => {
    hook = useNodes('canvas-mindmaps');
    return null;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    originalCanvasWorkspace = window.canvasWorkspace;
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        store: {
          load: vi.fn().mockResolvedValue({
            ok: true,
            data: { nodes: [source, target], edges: [edge] },
          }),
          save: vi.fn().mockResolvedValue({ ok: true }),
        },
      },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.loaded).toBe(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: originalCanvasWorkspace,
    });
  });

  it('merges a whole map and restores both maps and their edge in one undo', () => {
    let nextId = 0;
    act(() => {
      expect(hook.mergeMindmapTopic({
        sourceNodeId: 'source',
        sourceTopicId: 'source-root',
        targetNodeId: 'target',
        target: { kind: 'child', parentId: 'target-root' },
        createTopicId: () => `merged-${++nextId}`,
      })).toBe(true);
    });

    expect(hook.nodes.map((node) => node.id)).toEqual(['target']);
    expect(hook.edges[0].source.kind).toBe('point');

    act(() => {
      expect(hook.undo()).toBe(true);
    });
    expect(hook.nodes.map((node) => node.id)).toEqual(['source', 'target']);
    expect(hook.edges).toEqual([edge]);
  });

  it('splits a branch and restores it in one undo', () => {
    act(() => {
      expect(hook.splitMindmapTopic({
        sourceNodeId: 'source',
        sourceTopicId: 'branch',
        x: 640,
        y: 360,
        createNodeId: () => 'detached',
      })?.id).toBe('detached');
    });

    expect(hook.nodes.map((node) => node.id)).toEqual([
      'source',
      'target',
      'detached',
    ]);
    expect(
      (hook.nodes[0].data as MindmapNodeData).root.children,
    ).toEqual([]);

    act(() => {
      expect(hook.undo()).toBe(true);
    });
    expect(hook.nodes.map((node) => node.id)).toEqual(['source', 'target']);
    expect(
      (hook.nodes[0].data as MindmapNodeData).root.children[0].id,
    ).toBe('branch');
  });
});
