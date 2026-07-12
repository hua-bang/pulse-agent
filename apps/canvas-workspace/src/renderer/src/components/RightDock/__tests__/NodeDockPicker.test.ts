import { describe, expect, it } from 'vitest';
import type { KnowledgeTagDefinition, WorkspaceNodeListItem } from '../../../types';
import { filterDockNodes } from '../NodeDockPicker';

const tags: KnowledgeTagDefinition[] = [{ id: 'tag-ai', name: 'Artificial Intelligence' }];
const nodes: WorkspaceNodeListItem[] = [
  { id: 'one', title: 'Search systems', type: 'file', tags: ['tag-ai'], summary: 'Retrieval notes', workspaceId: 'ws-1', workspaceName: 'Research', hasData: true, linkCount: 0 },
  { id: 'two', title: 'Design', type: 'text', tags: [], summary: 'Interface notes', workspaceId: 'ws-2', workspaceName: 'Product', hasData: true, linkCount: 0 },
];

describe('filterDockNodes', () => {
  it('searches node fields, workspace names, and resolved tag names', () => {
    expect(filterDockNodes(nodes, tags, 'retrieval')).toEqual([nodes[0]]);
    expect(filterDockNodes(nodes, tags, 'research')).toEqual([nodes[0]]);
    expect(filterDockNodes(nodes, tags, 'artificial')).toEqual([nodes[0]]);
  });
});
