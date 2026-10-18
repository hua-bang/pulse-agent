import { describe, expect, it } from 'vitest';
import type { WorkspaceNodeListItem } from '../../../../types';
import { UNTAGGED_TAG_FILTER } from '../utils';
import {
  buildNodesAiScope,
  countNodeFacets,
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

  it('filters untagged nodes through the tag dimension', () => {
    const nodes = [
      node('one', { tags: [] }),
      node('two', { type: 'file', tags: [] }),
      node('three', { tags: ['keep'] }),
    ];

    expect(filterWorkspaceNodes(nodes, {
      activeWorkspaceIds: new Set(['ws-1']),
      query: '',
      typeFilter: 'text',
      tagFilter: UNTAGGED_TAG_FILTER,
    })).toEqual([nodes[0]]);
  });

  it('counts each option against the other active filters but not its own', () => {
    const nodes = [
      node('one', { tags: ['keep'] }),
      node('two', { type: 'file', tags: ['keep'] }),
      node('three', { tags: [] }),
      node('four', { tags: ['keep'], workspaceId: 'ws-2' }),
      node('five', { title: 'Hidden by search', tags: ['keep'] }),
    ];

    const facets = countNodeFacets(nodes, {
      activeWorkspaceIds: new Set(['ws-1']),
      query: 'node',
      typeFilter: 'text',
      tagFilter: 'keep',
    });

    expect(Object.fromEntries(facets.workspaces)).toEqual({ 'ws-1': 1, 'ws-2': 1 });
    expect(facets.workspacesAll).toBe(2);
    expect(Object.fromEntries(facets.types)).toEqual({ text: 1, file: 1 });
    expect(facets.typesAll).toBe(2);
    expect(Object.fromEntries(facets.tags)).toEqual({ keep: 1, [UNTAGGED_TAG_FILTER]: 1 });
    expect(facets.tagsAll).toBe(2);
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
    expect(buildNodesAiScope({ ...base, query: '', tagFilter: UNTAGGED_TAG_FILTER })).toBeNull();
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
