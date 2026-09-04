import { describe, expect, it } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../../../../types';
import {
  CanvasDocumentHistory,
  mergeExternalDocumentUpdate,
} from '../..';

const node = (id: string, title = id): CanvasNode => ({
  id,
  type: 'text',
  title,
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  data: { content: '', textColor: '#1f2328', backgroundColor: 'transparent' },
});

const edge = (id: string): CanvasEdge => ({
  id,
  source: { kind: 'point', x: 0, y: 0 },
  target: { kind: 'point', x: 10, y: 10 },
});

describe('CanvasDocumentHistory', () => {
  it('commits nodes and edges as one undoable document transaction', () => {
    const initial = { nodes: [node('before')], edges: [edge('edge-before')] };
    const history = new CanvasDocumentHistory(initial);

    history.apply({ nodes: [node('after')], edges: [] });

    expect(history.current).toEqual({ nodes: [node('after')], edges: [] });
    expect(history.undo()).toEqual(initial);
    expect(history.redo()).toEqual({ nodes: [node('after')], edges: [] });
  });

  it('collapses transient drag updates into one committed history step', () => {
    const initial = { nodes: [node('node-1')], edges: [] };
    const history = new CanvasDocumentHistory(initial);
    const moved = [{ ...node('node-1'), x: 120 }];

    history.apply({ nodes: moved }, false);
    expect(history.undo()).toBeNull();

    expect(history.commit()).toBe(true);
    expect(history.undo()).toEqual(initial);
    expect(history.redo()).toEqual({ nodes: moved, edges: [] });
  });
});

describe('mergeExternalDocumentUpdate', () => {
  it('applies external updates without deleting unsaved local state or requesting write-back', () => {
    const persisted = node('persisted', 'before');
    const local = node('local');
    const updated = node('persisted', 'after');
    const created = node('created');

    const result = mergeExternalDocumentUpdate({
      currentNodes: [persisted, local],
      currentEdges: [edge('local-edge')],
      diskNodes: [updated, created],
      diskEdges: [edge('external-edge')],
      changedNodeIds: new Set(['persisted', 'local', 'created']),
      changedEdgeIds: new Set(['local-edge', 'external-edge']),
      persistedNodeIds: new Set(['persisted']),
      persistedEdgeIds: new Set(),
    });

    expect(result.nodes).toEqual([updated, local, created]);
    expect(result.edges.map(item => item.id)).toEqual(['local-edge', 'external-edge']);
    expect(result.createdNodes).toEqual([created]);
  });
});
