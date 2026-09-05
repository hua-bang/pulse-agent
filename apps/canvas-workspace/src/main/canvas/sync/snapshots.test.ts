import { describe, expect, it } from 'vitest';
import { diffSnapshots, itemsToMap, visibleNodeFieldsChanged } from './snapshots';

describe('canvas sync snapshots', () => {
  it('detects created, updated, structurally changed, and deleted items', () => {
    const before = itemsToMap([
      { id: 'updated', updatedAt: 1, value: 'old' },
      { id: 'structural', updatedAt: 1, value: 'old' },
      { id: 'deleted', updatedAt: 1 },
    ]);
    const after = itemsToMap([
      { id: 'updated', updatedAt: 2, value: 'new' },
      { id: 'structural', updatedAt: 1, value: 'new' },
      { id: 'created', updatedAt: 1 },
    ]);

    expect(diffSnapshots(before, after).sort()).toEqual([
      'created', 'deleted', 'structural', 'updated',
    ]);
  });

  it('ignores metadata and object-key ordering while detecting visible changes', () => {
    const previous = JSON.stringify({
      type: 'text', title: 'A', data: { first: 1, second: 2 }, updatedAt: 1,
    });
    const metadataOnly = JSON.stringify({
      type: 'text', title: 'A', data: { second: 2, first: 1 }, updatedAt: 2,
    });
    const changed = JSON.stringify({
      type: 'text', title: 'B', data: { first: 1, second: 2 }, updatedAt: 2,
    });

    expect(visibleNodeFieldsChanged(previous, metadataOnly)).toBe(false);
    expect(visibleNodeFieldsChanged(previous, changed)).toBe(true);
    expect(visibleNodeFieldsChanged('{bad', changed)).toBe(true);
  });
});
