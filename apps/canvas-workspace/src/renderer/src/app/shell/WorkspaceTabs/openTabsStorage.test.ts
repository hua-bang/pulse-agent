import { describe, expect, it } from 'vitest';
import { workspaceIdForTabIndex } from './openTabsStorage';

const workspaces = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

describe('workspaceIdForTabIndex', () => {
  it('follows the open-tab order, not the workspace list order', () => {
    expect(workspaceIdForTabIndex(1, ['c', 'a'], workspaces)).toBe('c');
    expect(workspaceIdForTabIndex(2, ['c', 'a'], workspaces)).toBe('a');
  });

  it('maps 9 to the last tab', () => {
    expect(workspaceIdForTabIndex(9, ['c', 'a', 'd'], workspaces)).toBe('d');
  });

  it('returns null past the last tab', () => {
    expect(workspaceIdForTabIndex(3, ['c', 'a'], workspaces)).toBeNull();
  });

  it('skips tabs whose workspace no longer exists', () => {
    expect(workspaceIdForTabIndex(1, ['gone', 'b'], workspaces)).toBe('b');
  });

  it('falls back to the workspace list when no tab is open', () => {
    expect(workspaceIdForTabIndex(2, [], workspaces)).toBe('b');
    expect(workspaceIdForTabIndex(9, [], workspaces)).toBe('d');
    expect(workspaceIdForTabIndex(1, [], [])).toBeNull();
  });
});
