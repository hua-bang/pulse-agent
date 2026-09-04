import { describe, expect, it } from 'vitest';
import {
  mergeExternalDocumentUpdate,
  shouldReloadForExternalUpdate,
} from '../..';

describe('shouldReloadForExternalUpdate', () => {
  it('reloads for an edge-only external update', () => {
    expect(shouldReloadForExternalUpdate({
      workspaceId: 'ws',
      nodeIds: [],
      edgeIds: ['edge-1'],
      source: 'fs-watch',
    })).toBe(true);
  });

  it('ignores an empty external update', () => {
    expect(shouldReloadForExternalUpdate({
      workspaceId: 'ws',
      nodeIds: [],
      edgeIds: [],
      source: 'fs-watch',
    })).toBe(false);
  });
});

describe('mergeExternalDocumentUpdate', () => {
  it('keeps a locally-created unsaved edge while applying an external edge create', () => {
    const local = {
      id: 'local',
      source: { kind: 'point' as const, x: 0, y: 0 },
      target: { kind: 'point' as const, x: 10, y: 10 },
    };
    const external = {
      id: 'external',
      source: { kind: 'point' as const, x: 20, y: 20 },
      target: { kind: 'point' as const, x: 30, y: 30 },
    };

    expect(mergeExternalDocumentUpdate({
      currentNodes: [],
      currentEdges: [local],
      diskNodes: [],
      diskEdges: [external],
      changedNodeIds: new Set(),
      changedEdgeIds: new Set(['external']),
      persistedNodeIds: new Set(),
      persistedEdgeIds: new Set(),
    }).edges.map((item) => item.id)).toEqual(['local', 'external']);
  });
});
