import { describe, expect, it } from 'vitest';
import { shouldReloadForExternalUpdate } from './useNodes';
import { mergeExternalEdgeUpdate } from './external-edge-sync';

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

describe('mergeExternalEdgeUpdate', () => {
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

    expect(mergeExternalEdgeUpdate(
      [local],
      [external],
      new Set(['external']),
      new Set(),
    ).map((edge) => edge.id)).toEqual(['local', 'external']);
  });
});
