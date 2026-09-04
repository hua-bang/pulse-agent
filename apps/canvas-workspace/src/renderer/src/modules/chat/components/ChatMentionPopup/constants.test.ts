import { describe, expect, it } from 'vitest';
import type { MentionItem } from '../../../../types';
import { MENTION_GROUP_MAX_ITEMS, sortAndCapMentionItems } from './constants';

describe('sortAndCapMentionItems', () => {
  it('never lets a busy node-type group crowd a smaller, later group out entirely', () => {
    // Reproduces the reported bug: a canvas with many mindmap nodes left the
    // popup with zero Canvas (workspace) entries, because a flat sort +
    // slice(0, MENTION_MAX_ITEMS) is applied AFTER sorting by group, and
    // 'canvas' sorts after every node-type group.
    const manyMindmapNodes: MentionItem[] = Array.from({ length: 40 }, (_, i) => ({
      type: 'node',
      nodeType: 'mindmap',
      label: `Mindmap topic ${i}`,
    }));
    const workspaces: MentionItem[] = Array.from({ length: 3 }, (_, i) => ({
      type: 'workspace',
      label: `Workspace ${i}`,
      workspaceId: `workspace-${i}`,
    }));

    const result = sortAndCapMentionItems([...manyMindmapNodes, ...workspaces]);

    const canvasItems = result.filter(item => item.type === 'workspace');
    expect(canvasItems).toHaveLength(3);
    expect(canvasItems.map(item => item.label)).toEqual(['Workspace 0', 'Workspace 1', 'Workspace 2']);
  });

  it('caps each group independently instead of a single flat total', () => {
    const manyMindmapNodes: MentionItem[] = Array.from({ length: 20 }, (_, i) => ({
      type: 'node',
      nodeType: 'mindmap',
      label: `Mindmap topic ${i}`,
    }));
    const twoTags: MentionItem[] = [
      { type: 'tag', label: 'launch' },
      { type: 'tag', label: 'roadmap' },
    ];

    const result = sortAndCapMentionItems([...manyMindmapNodes, ...twoTags]);

    expect(result.filter(item => item.type === 'node')).toHaveLength(MENTION_GROUP_MAX_ITEMS);
    // A group with fewer items than the cap keeps all of them, not padded.
    expect(result.filter(item => item.type === 'tag')).toHaveLength(2);
  });

  it('keeps items within a group in their original order', () => {
    const items: MentionItem[] = [
      { type: 'tag', label: 'first' },
      { type: 'tag', label: 'second' },
      { type: 'tag', label: 'third' },
    ];

    expect(sortAndCapMentionItems(items).map(item => item.label)).toEqual(['first', 'second', 'third']);
  });
});
