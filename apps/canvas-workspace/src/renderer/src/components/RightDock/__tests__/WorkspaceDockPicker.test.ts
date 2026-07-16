import { describe, expect, it } from 'vitest';
import type { WorkspaceEntry } from '../../../hooks/useWorkspaces';
import { filterWorkspaces } from '../WorkspaceDockPicker';

const workspaces: WorkspaceEntry[] = [
  { id: 'ws-1', name: 'Research' },
  { id: 'ws-2', name: 'Product Design' },
  { id: 'ws-3', name: 'Growth Experiments' },
];

describe('filterWorkspaces', () => {
  it('returns all workspaces when the query is blank', () => {
    expect(filterWorkspaces(workspaces, '')).toEqual(workspaces);
    expect(filterWorkspaces(workspaces, '   ')).toEqual(workspaces);
  });

  it('matches workspace names case-insensitively on a substring', () => {
    expect(filterWorkspaces(workspaces, 'design')).toEqual([workspaces[1]]);
    expect(filterWorkspaces(workspaces, 'RESEARCH')).toEqual([workspaces[0]]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterWorkspaces(workspaces, 'terminal')).toEqual([]);
  });
});
