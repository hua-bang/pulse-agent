import { describe, expect, it } from 'vitest';
import { selectActiveAfterDeletion, type WorkspaceEntry } from './useWorkspaces';

const ws = (id: string): WorkspaceEntry => ({ id, name: id });

describe('selectActiveAfterDeletion', () => {
  const list = [ws('a'), ws('b'), ws('c')];

  it('keeps the active workspace when deleting a different one', () => {
    expect(selectActiveAfterDeletion(list, 'b', 'a')).toEqual({
      newActiveId: 'a',
      switchedActive: false,
    });
  });

  it('moves to the next sibling when deleting the active workspace', () => {
    expect(selectActiveAfterDeletion(list, 'b', 'b')).toEqual({
      newActiveId: 'c',
      switchedActive: true,
    });
  });

  it('falls back to the new last entry when deleting the active last workspace', () => {
    expect(selectActiveAfterDeletion(list, 'c', 'c')).toEqual({
      newActiveId: 'b',
      switchedActive: true,
    });
  });

  it('moves to the new first entry when deleting the active first workspace', () => {
    expect(selectActiveAfterDeletion(list, 'a', 'a')).toEqual({
      newActiveId: 'b',
      switchedActive: true,
    });
  });
});
