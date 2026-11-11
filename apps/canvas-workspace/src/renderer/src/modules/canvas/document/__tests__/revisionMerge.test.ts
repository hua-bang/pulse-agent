import { describe, expect, it } from 'vitest';
import type { CanvasNode, CanvasSaveData } from '../../../../types';
import { mergeDocumentRevision } from '../revisionMerge';

const node = (id = 'a'): CanvasNode => ({
  id, type: 'text', title: 'Original', x: 0, y: 0, width: 100, height: 100,
  data: { content: 'base', textColor: '#111', backgroundColor: '#fff' }, updatedAt: 1,
});
const document = (nodes: CanvasNode[], revision = 1): CanvasSaveData => ({
  nodes, edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: '', revision,
});

describe('revision three-way merge', () => {
  it('requires an explicit backend rebase before changing the storage generation', () => {
    const base = document([node()], 1);
    const local = document([{ ...node(), title: 'Local' }], 1);
    const remote = { ...document([{ ...node(), x: 90 }], 1), storageGeneration: 'new-database' };
    expect(mergeDocumentRevision(base, local, remote))
      .toEqual({ ok: false, conflicts: ['storageGeneration'] });
    expect(mergeDocumentRevision(base, local, remote, { allowStorageGenerationChange: true }))
      .toMatchObject({ ok: true, data: { storageGeneration: 'new-database', revision: 1, nodes: [{ title: 'Local', x: 90 }] } });
  });

  it('merges independent fields on one node while treating updatedAt as metadata', () => {
    const base = document([node()]);
    const local = document([{ ...node(), title: 'Local', updatedAt: 20 }]);
    const remote = document([{ ...node(), data: { ...node().data, content: 'Remote' }, updatedAt: 30 }], 2);
    expect(mergeDocumentRevision(base, local, remote)).toMatchObject({
      ok: true,
      data: { revision: 2, nodes: [{ title: 'Local', data: { content: 'Remote' }, updatedAt: 30 }] },
    });
  });

  it('keeps the local value for same-field edits and delete-versus-edit, and reports the paths', () => {
    const base = document([node()]);
    const local = document([{ ...node(), title: 'Local' }]);
    expect(mergeDocumentRevision(base, local, document([{ ...node(), title: 'Remote', x: 90 }], 2)))
      .toMatchObject({ ok: true, overridden: ['nodes.a.title'], data: { revision: 2, nodes: [{ title: 'Local', x: 90 }] } });
    expect(mergeDocumentRevision(base, local, document([], 2)))
      .toMatchObject({ ok: true, overridden: ['nodes.a'], data: { nodes: [{ id: 'a', title: 'Local' }] } });
    expect(mergeDocumentRevision(base, document([]), document([{ ...node(), title: 'Remote' }], 2)))
      .toMatchObject({ ok: true, overridden: ['nodes.a'], data: { nodes: [] } });
    expect(local.nodes[0].title).toBe('Local');
  });

  it('drops an edge of one side that points at a node the other side deleted', () => {
    const base = document([node('a')]);
    const remote: CanvasSaveData = {
      ...document([node('a'), node('b')], 2),
      edges: [{ id: 'a-b', source: { kind: 'node', nodeId: 'a' }, target: { kind: 'node', nodeId: 'b' } }],
    };
    const result = mergeDocumentRevision(base, document([]), remote);
    expect(result).toMatchObject({ ok: true, data: { nodes: [{ id: 'b' }], edges: [] } });
  });

  it('keeps independent creations and accepts a deletion despite timestamp-only local changes', () => {
    const base = document([node()]);
    const local = document([{ ...node(), updatedAt: 20 }, node('local')]);
    const remote = document([node('remote')], 2);
    const result = mergeDocumentRevision(base, local, remote);
    expect(result.ok && result.data.nodes.map(item => item.id)).toEqual(['remote', 'local']);
  });

  it('keeps the local order for incompatible reorderings without losing an item', () => {
    const [a, b, c] = [node('a'), node('b'), node('c')];
    const result = mergeDocumentRevision(document([a, b, c]), document([b, a, c]), document([a, c, b], 2));
    expect(result).toMatchObject({ ok: true, overridden: ['nodes.order'] });
    expect(result.ok && result.data.nodes.map(item => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('preserves insertions from both sides relative to the existing order', () => {
    const [a, b, local, remote] = [node('a'), node('b'), node('local'), node('remote')];
    const result = mergeDocumentRevision(document([a, b]), document([a, local, b]), document([a, remote, b], 2));
    expect(result.ok && result.data.nodes.map(item => item.id)).toEqual(['a', 'remote', 'local', 'b']);
  });

  it('merges independent edge fields and viewport axes', () => {
    const base = document([node()]);
    base.edges = [{ id: 'e', source: { kind: 'node', nodeId: 'a' }, target: { kind: 'point', x: 10, y: 10 }, label: 'base', bend: 0 }];
    const local = { ...base, edges: [{ ...base.edges[0], label: 'local', updatedAt: 10 }], transform: { ...base.transform, x: 30 } };
    const remote = { ...base, revision: 2, edges: [{ ...base.edges[0], bend: 20, updatedAt: 15 }], transform: { ...base.transform, y: 40 } };
    expect(mergeDocumentRevision(base, local, remote)).toMatchObject({
      ok: true,
      data: { edges: [{ label: 'local', bend: 20, updatedAt: 15 }], transform: { x: 30, y: 40 } },
    });
  });

  describe('mindmap topics', () => {
    type Topic = { id: string; text: string; children: Topic[] };
    const topic = (id: string, children: Topic[] = [], text = id): Topic => ({ id, text, children });
    const mindmap = (root: Topic, rev = 1): CanvasNode => ({
      id: 'm', type: 'mindmap', title: 'Map', x: 0, y: 0, width: 400, height: 300,
      data: { root, layout: 'right', rev } as CanvasNode['data'], updatedAt: 1,
    });
    const merge = (base: Topic, local: Topic, remote: Topic) => {
      const result = mergeDocumentRevision(
        document([mindmap(base)]), document([mindmap(local, 2)]), document([mindmap(remote, 3)], 2),
      );
      if (!result.ok) throw new Error('merge failed');
      return { root: (result.data.nodes[0].data as { root: Topic }).root, result };
    };

    it('merges edits of different topics instead of keeping one whole tree', () => {
      const base = topic('root', [topic('a'), topic('b')]);
      const local = topic('root', [topic('a', [], 'A local'), topic('b')]);
      const remote = topic('root', [topic('a'), topic('b', [topic('b1')], 'B remote')]);
      const { root, result } = merge(base, local, remote);
      expect(root).toEqual(topic('root', [topic('a', [], 'A local'), topic('b', [topic('b1')], 'B remote')]));
      expect(result.overridden).toEqual([]);
      expect((result.data.nodes[0].data as { rev: number }).rev).toBe(3);
    });

    it('keeps topics that both sides added, and a deletion by one side', () => {
      const base = topic('root', [topic('a'), topic('b'), topic('c')]);
      const local = topic('root', [topic('a'), topic('local'), topic('b'), topic('c')]);
      const remote = topic('root', [topic('a'), topic('b'), topic('remote')]);
      const { root } = merge(base, local, remote);
      expect(root.children.map(child => child.id)).toEqual(['a', 'local', 'b', 'remote']);
    });

    it('keeps the local text of a topic that both sides renamed, and reports it', () => {
      const base = topic('root', [topic('a')]);
      const { root, result } = merge(
        base, topic('root', [topic('a', [], 'Local')]), topic('root', [topic('a', [], 'Remote')]),
      );
      expect(root.children[0].text).toBe('Local');
      expect(result.overridden).toEqual(['nodes.m.data.root.children.a.text']);
    });

    it('keeps the local tree when a merge by id would hold a topic twice', () => {
      const base = topic('root', [topic('a', [topic('t')]), topic('b')]);
      // Local renames the topic in place. Remote moves it under another parent.
      const local = topic('root', [topic('a', [topic('t', [], 'Renamed')]), topic('b')]);
      const remote = topic('root', [topic('a'), topic('b', [topic('t')])]);
      const { root, result } = merge(base, local, remote);
      expect(root).toEqual(local);
      expect(result.overridden).toContain('nodes.m.data.root');
    });
  });
});
