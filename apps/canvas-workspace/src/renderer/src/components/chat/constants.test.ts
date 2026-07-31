import { describe, expect, it } from 'vitest';
import { messages } from '../../i18n/messages';
import { KNOWLEDGE_QUICK_ACTIONS, MENTION_GROUP_MAX_ITEMS, sortAndCapMentionItems } from './constants';
import type { MentionItem } from './types';

describe('KNOWLEDGE_QUICK_ACTIONS', () => {
  it('uses knowledge-specific semantic keys without embedded English copy', () => {
    expect(KNOWLEDGE_QUICK_ACTIONS.map((action) => action.key)).toEqual([
      'summarize_knowledge',
      'discover_themes',
      'improve_node',
    ]);

    for (const action of KNOWLEDGE_QUICK_ACTIONS) {
      expect(action).not.toHaveProperty('label');
      expect(action).not.toHaveProperty('prompt');
    }
  });

  it('resolves every knowledge action label and prompt through both locales', () => {
    expect(KNOWLEDGE_QUICK_ACTIONS.map((action) => ({
      enLabel: messages.en[action.labelKey],
      enPrompt: messages.en[action.promptKey],
      zhLabel: messages.zh[action.labelKey],
      zhPrompt: messages.zh[action.promptKey],
    }))).toEqual([
      {
        enLabel: 'Summarize knowledge',
        enPrompt: 'Summarize the main ideas in my knowledge library. Cite the nodes you used.',
        zhLabel: '总结知识库',
        zhPrompt: '总结我的知识库中的主要观点，并标明使用了哪些节点。',
      },
      {
        enLabel: 'Discover themes',
        enPrompt: 'Find the main themes and meaningful relationships across my knowledge nodes.',
        zhLabel: '发现主要主题',
        zhPrompt: '找出知识节点中的主要主题和有意义的关联。',
      },
      {
        enLabel: 'Improve this node',
        enPrompt: 'Review the selected node, then propose one concrete improvement for me to approve.',
        zhLabel: '改进这个节点',
        zhPrompt: '检查选中的节点，提出一项具体改进，等我确认后再应用。',
      },
    ]);
  });
});

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
