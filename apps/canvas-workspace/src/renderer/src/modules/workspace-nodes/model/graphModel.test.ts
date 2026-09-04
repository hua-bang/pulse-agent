import { describe, expect, it } from 'vitest';
import type { WorkspaceNodeListItem } from '../../../types';
import {
  buildWorkspaceGraph,
  getWorkspaceGraphHighlight,
  searchWorkspaceGraph,
} from '..';

const node = (patch: Partial<WorkspaceNodeListItem>): WorkspaceNodeListItem => ({
  id: 'node-1', type: 'text', title: 'First', tags: [], links: [],
  createdAt: 1, updatedAt: 1, onCanvas: true, workspaceId: 'ws-1', workspaceName: 'One',
  hasData: true, linkCount: 0,
  ...patch,
});

describe('workspace graph model', () => {
  it('projects workspace hubs, tags, links, and explicit missing targets', () => {
    const graph = buildWorkspaceGraph({
      nodes: [
        node({ id: 'a', title: 'Alpha', tags: ['tag-1'], links: [{ relation: 'links-to', target: { nodeId: 'b' } }] }),
      ],
      tags: [{ id: 'tag-1', name: 'Research' }],
      workspaces: [{ id: 'ws-1', name: 'One' }],
      options: { showTags: true, showLinks: true, showWorkspaceHubs: true },
      untitled: 'Untitled',
    });
    expect(graph.nodes.map((item) => item.id).sort()).toEqual([
      'tag:tag-1', 'ws-1:a', 'ws-1:b', 'ws:ws-1',
    ]);
    expect(graph.nodes.find((item) => item.id === 'ws-1:b')?.kind).toBe('missing');
    expect(graph.links).toHaveLength(3);
  });

  it('searches graph-visible tags/nodes and highlights an anchor plus its neighbors', () => {
    const nodes = [node({ id: 'a', title: 'Alpha', tags: ['tag-1'] })];
    const tags = [{ id: 'tag-1', name: 'Research' }];
    const results = searchWorkspaceGraph({ nodes, tags, query: 'research', showTags: true });
    expect(results.map((result) => result.kind)).toEqual(['tag', 'node']);
    const graph = buildWorkspaceGraph({
      nodes,
      tags,
      workspaces: [{ id: 'ws-1', name: 'One' }],
      options: { showTags: true, showLinks: false, showWorkspaceHubs: false },
      untitled: 'Untitled',
    });
    const highlight = getWorkspaceGraphHighlight(graph, 'ws-1:a');
    expect([...highlight.nodeIds].sort()).toEqual(['tag:tag-1', 'ws-1:a']);
    expect(highlight.linkIds.has('ws-1:a->tag:tag-1')).toBe(true);
  });
});
