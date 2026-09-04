import { describe, expect, it } from 'vitest';
import type { WorkspaceNodeListItem } from '../../../../types';
import {
  buildNodesAiScope,
  filterWorkspaceNodes,
  nodeKey,
  reconcileNodeSelection,
} from './nodesPageModel';

const node = (
  id: string,
  overrides: Partial<WorkspaceNodeListItem> = {},
): WorkspaceNodeListItem => ({
  id,
  type: 'text',
  title: `Node ${id}`,
  tags: [],
  hasData: true,
  linkCount: 0,
  workspaceId: 'ws-1',
  workspaceName: 'Workspace One',
  ...overrides,
});

describe('nodesPageModel', () => {
  it('combines workspace, query, type, and tag filters', () => {
    const nodes = [
      node('one', { title: 'Alpha', tags: ['keep'] }),
      node('two', { title: 'Alpha', type: 'file', tags: ['keep'] }),
      node('three', { title: 'Beta', tags: ['keep'], workspaceId: 'ws-2' }),
    ];

    expect(filterWorkspaceNodes(nodes, {
      activeWorkspaceIds: new Set(['ws-1']),
      query: 'alpha',
      typeFilter: 'text',
      tagFilter: 'keep',
    })).toEqual([nodes[0]]);
  });

  it('uses exact node refs for a bounded filtered result', () => {
    const nodes = [node('one'), node('two')];

    expect(buildNodesAiScope({
      filteredNodes: nodes,
      workspaces: [{ id: 'ws-1', name: 'Workspace One' }],
      activeWorkspaceIds: new Set(['ws-1']),
      selectedWorkspaceIds: null,
      query: 'node',
      typeFilter: 'all',
      tagFilter: null,
      tagDefinitions: [],
      untitled: 'Untitled',
    })).toEqual({
      nodes: [
        { id: 'one', title: 'Node one', type: 'text', workspaceId: 'ws-1' },
        { id: 'two', title: 'Node two', type: 'text', workspaceId: 'ws-1' },
      ],
    });
  });

  it('rejects lossy large query scopes but preserves durable tag scopes', () => {
    const nodes = Array.from({ length: 13 }, (_, index) => node(String(index), {
      tags: ['tag-1'],
    }));
    const base = {
      filteredNodes: nodes,
      workspaces: [{ id: 'ws-1', name: 'Workspace One' }],
      activeWorkspaceIds: new Set(['ws-1']),
      selectedWorkspaceIds: null,
      typeFilter: 'all' as const,
      tagDefinitions: [{ id: 'tag-1', name: 'Important' }],
      untitled: 'Untitled',
    };

    expect(buildNodesAiScope({ ...base, query: 'node', tagFilter: null })).toBeNull();
    expect(buildNodesAiScope({ ...base, query: '', tagFilter: 'tag-1' })).toEqual({
      nodes: [],
      tags: [{ name: 'Important', workspaceIds: ['ws-1'] }],
    });
  });

  it('removes selected keys that no longer have a backing node', () => {
    const current = new Set(['ws-1:one', 'ws-1:missing']);
    expect(reconcileNodeSelection(current, [node('one')])).toEqual(new Set(['ws-1:one']));
    expect(nodeKey(node('one'))).toBe('ws-1:one');
  });
});
