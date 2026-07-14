import { describe, expect, it } from 'vitest';
import { messages } from '../../i18n/messages';
import { KNOWLEDGE_QUICK_ACTIONS } from './constants';

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
