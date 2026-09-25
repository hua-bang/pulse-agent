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

  it('rejects same-field edits and delete-versus-edit without mutating inputs', () => {
    const base = document([node()]);
    const local = document([{ ...node(), title: 'Local' }]);
    expect(mergeDocumentRevision(base, local, document([{ ...node(), title: 'Remote' }], 2)))
      .toEqual({ ok: false, conflicts: ['nodes.a.title'] });
    expect(mergeDocumentRevision(base, local, document([], 2)))
      .toEqual({ ok: false, conflicts: ['nodes.a'] });
    expect(local.nodes[0].title).toBe('Local');
  });

  it('keeps independent creations and accepts a deletion despite timestamp-only local changes', () => {
    const base = document([node()]);
    const local = document([{ ...node(), updatedAt: 20 }, node('local')]);
    const remote = document([node('remote')], 2);
    const result = mergeDocumentRevision(base, local, remote);
    expect(result.ok && result.data.nodes.map(item => item.id)).toEqual(['remote', 'local']);
  });

  it('rejects incompatible reorderings rather than silently dropping one side', () => {
    const [a, b, c] = [node('a'), node('b'), node('c')];
    expect(mergeDocumentRevision(document([a, b, c]), document([b, a, c]), document([a, c, b], 2)))
      .toEqual({ ok: false, conflicts: ['nodes.order'] });
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
});
