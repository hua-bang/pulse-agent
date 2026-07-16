import { describe, expect, it } from 'vitest';
import { formatReferencedTabsBlock } from './referenced-tabs-context';

describe('formatReferencedTabsBlock', () => {
  it('returns an empty string when there are no tabs', () => {
    expect(formatReferencedTabsBlock([])).toBe('');
    expect(formatReferencedTabsBlock(undefined)).toBe('');
  });

  it('emits the exact read call per tab kind', () => {
    const block = formatReferencedTabsBlock(
      [
        { id: 'link:1', kind: 'link', title: 'Docs', url: 'https://x.dev', workspaceId: 'ws-1' },
        { id: 'art', kind: 'artifact', title: 'Dash', workspaceId: 'ws-1', artifactId: 'a1' },
        { id: 'term', kind: 'terminal', title: 'Dev', sessionId: 'workspace-terminal:ws-1' },
        { id: 'nd', kind: 'node-detail', title: 'Note', workspaceId: 'ws-1', nodeId: 'node-9' },
      ],
      'ws-1',
    );

    expect(block).toContain('Referenced Tabs — 4 tabs');
    expect(block).toContain('canvas_read_tab({ kind: "link", tabId: "link:1", workspaceId: "ws-1" })');
    expect(block).toContain('canvas_read_tab({ kind: "artifact", artifactId: "a1", workspaceId: "ws-1" })');
    expect(block).toContain('canvas_read_tab({ kind: "terminal", sessionId: "workspace-terminal:ws-1" })');
    expect(block).toContain('canvas_read_node({ nodeId: "node-9", workspaceId: "ws-1" })');
  });

  it('falls back to the current workspace id when a tab omits its own', () => {
    const block = formatReferencedTabsBlock(
      [{ id: 'link:1', kind: 'link', title: 'Docs', url: 'https://x.dev' }],
      'ws-current',
    );
    expect(block).toContain('workspaceId: "ws-current"');
  });
});
