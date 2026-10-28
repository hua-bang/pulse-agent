import { describe, expect, it } from 'vitest';
import type { AgentContextTabRef, CanvasNode } from '../../../../types';
import { groupMentionEntries, MENTION_GROUP_MAX_ENTRIES, type MentionEntry } from './mentionGroups';

const node = (id: string, type: CanvasNode['type'], title: string): CanvasNode => ({
  id,
  type,
  title,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  data: {},
} as CanvasNode);

const terminalTab: AgentContextTabRef = { id: 'terminal:2', kind: 'terminal', title: 'Claude 2', workspaceId: 'ws' };
const linkTab: AgentContextTabRef = { id: 'link:1', kind: 'link', title: 'Docs', url: 'https://docs.example.com', workspaceId: 'ws' };

const typeLabel = (entry: MentionEntry) => (entry.kind === 'tab' ? entry.tab.kind : entry.node.type);
const keys = (groups: ReturnType<typeof groupMentionEntries>) => groups.map(group => [group.key, group.entries.map(entry => entry.key)]);

describe('groupMentionEntries', () => {
  it('puts dock tabs first, then groups nodes by type in a stable order', () => {
    const groups = groupMentionEntries({
      nodes: [node('t1', 'text', 'Text'), node('f1', 'frame', 'Plan'), node('l1', 'iframe', 'Site'), node('f2', 'frame', 'Notes')],
      tabs: [terminalTab, linkTab],
      query: '',
      typeLabel,
    });

    expect(keys(groups)).toEqual([
      ['tab', ['tab:terminal:2', 'tab:link:1']],
      ['frame', ['node:f1', 'node:f2']],
      ['text', ['node:t1']],
      ['iframe', ['node:l1']],
    ]);
  });

  it('matches titles, URLs and type labels, and drops empty groups', () => {
    const nodes = [node('f1', 'frame', 'Plan'), node('t1', 'terminal', 'Build')];
    const tabs = [terminalTab, linkTab];

    expect(keys(groupMentionEntries({ nodes, tabs, query: 'claude', typeLabel }))).toEqual([['tab', ['tab:terminal:2']]]);
    expect(keys(groupMentionEntries({ nodes, tabs, query: 'docs.example', typeLabel }))).toEqual([['tab', ['tab:link:1']]]);
    expect(keys(groupMentionEntries({ nodes, tabs, query: 'terminal', typeLabel }))).toEqual([
      ['tab', ['tab:terminal:2']],
      ['terminal', ['node:t1']],
    ]);
  });

  it('caps each group so one large type cannot hide the others', () => {
    const texts = Array.from({ length: MENTION_GROUP_MAX_ENTRIES + 3 }, (_, i) => node(`t${i}`, 'text', `Text ${i}`));
    const groups = groupMentionEntries({ nodes: [...texts, node('f1', 'frame', 'Plan')], tabs: [], query: '', typeLabel });

    expect(groups.map(group => [group.key, group.entries.length])).toEqual([
      ['frame', 1],
      ['text', MENTION_GROUP_MAX_ENTRIES],
    ]);
  });
});
