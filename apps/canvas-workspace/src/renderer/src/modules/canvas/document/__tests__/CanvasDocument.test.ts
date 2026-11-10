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

  it('keeps a node that another writer created when the user undoes', () => {
    const initial = { nodes: [node('mine')], edges: [] };
    const history = new CanvasDocumentHistory(initial);
    history.apply({ nodes: [node('mine', 'Renamed')] });

    history.applyExternal({ nodes: [node('mine', 'Renamed'), node('agent')], edges: [edge('agent-edge')] });

    // The external change is not an undo step of this user.
    expect(history.commit()).toBe(false);
    expect(history.undo()).toEqual({ nodes: [node('mine'), node('agent')], edges: [edge('agent-edge')] });
    expect(history.undo()).toBeNull();
    expect(history.redo()).toEqual({
      nodes: [node('mine', 'Renamed'), node('agent')],
      edges: [edge('agent-edge')],
    });
  });

  it('applies an external edit and an external delete to every recorded state', () => {
    const linked: CanvasEdge = {
      id: 'linked',
      source: { kind: 'node', nodeId: 'gone' },
      target: { kind: 'point', x: 10, y: 10 },
    };
    const initial = { nodes: [node('kept'), node('gone')], edges: [linked] };
    const history = new CanvasDocumentHistory(initial);
    history.apply({ nodes: [{ ...node('kept'), x: 50 }, node('gone')] });

    const edited = { ...node('kept', 'Agent title'), x: 50, data: { ...node('kept').data, content: 'Agent text' } };
    history.applyExternal({ nodes: [edited], edges: [] });

    // The user's move is undone; the other writer's edit and delete stay.
    expect(history.undo()).toEqual({
      nodes: [{ ...edited, x: 0 }],
      edges: [],
    });
  });

  it('keeps an unfinished drag separate from an external change', () => {
    const initial = { nodes: [node('mine')], edges: [] };
    const history = new CanvasDocumentHistory(initial);
    history.apply({ nodes: [{ ...node('mine'), x: 40 }] }, false);

    history.applyExternal({ nodes: [{ ...node('mine'), x: 40 }, node('agent')], edges: [] });

    expect(history.commit()).toBe(true);
    expect(history.undo()).toEqual({ nodes: [node('mine'), node('agent')], edges: [] });
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
