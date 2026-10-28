import { describe, expect, it } from 'vitest';
import { buildTabMention, buildTabMentionInsertion } from './nodeMention';

describe('buildTabMention', () => {
  it('points a web tab at its URL and a node-detail tab at its node', () => {
    expect(buildTabMention({ id: 'link:1', kind: 'link', title: 'Docs', url: 'https://x.dev' })).toBe('@[Docs](https://x.dev)');
    expect(buildTabMention({ id: 'nd', kind: 'node-detail', title: 'Note', nodeId: 'node-9' })).toBe('@[Note](canvas:node-9)');
  });

  it('points other tabs at their dock tab id', () => {
    expect(buildTabMention({ id: 'terminal:2', kind: 'terminal', title: 'Claude 2' })).toBe('@[Claude 2](tab:terminal:2)');
    expect(buildTabMentionInsertion({ id: 'terminal', kind: 'terminal', title: 'Terminal 1' })).toBe(' @[Terminal 1](tab:terminal) ');
  });
});
