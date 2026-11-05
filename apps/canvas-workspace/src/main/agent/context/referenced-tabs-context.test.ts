import { describe, expect, it } from 'vitest';
import { formatOpenPluginPagesBlock, formatReferencedTabsBlock } from './referenced-tabs-context';

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
        { id: 'canvas', kind: 'canvas', title: 'Research', workspaceId: 'ws-2' },
      ],
      'ws-1',
    );

    expect(block).toContain('Referenced Tabs — 5 tabs');
    expect(block).toContain('dock_read_tab({ kind: "link", tabId: "link:1", workspaceId: "ws-1" })');
    expect(block).toContain('dock_read_tab({ kind: "artifact", artifactId: "a1", workspaceId: "ws-1" })');
    expect(block).toContain('dock_read_tab({ kind: "terminal", sessionId: "workspace-terminal:ws-1" })');
    expect(block).toContain('workspace_node_get({ nodeId: "node-9", workspaceId: "ws-1" })');
    expect(block).toContain('canvas_read_context({ workspaceId: "ws-2" })');
  });

  it('falls back to the current workspace id when a tab omits its own', () => {
    const block = formatReferencedTabsBlock(
      [{ id: 'link:1', kind: 'link', title: 'Docs', url: 'https://x.dev' }],
      'ws-current',
    );
    expect(block).toContain('workspaceId: "ws-current"');
  });
});

describe('formatOpenPluginPagesBlock', () => {
  it('lists open plugin pages as read pointers only', () => {
    expect(formatOpenPluginPagesBlock([])).toBe('');
    const block = formatOpenPluginPagesBlock([{
      nodeId: 'plugin:weread/main',
      pluginId: 'weread',
      viewId: 'main',
      title: '三体',
      url: 'https://weread.test/reader',
    }]);
    expect(block).toContain('## Open Plugin Pages');
    expect(block).toContain('**三体** (plugin weread) — nodeId `plugin:weread/main`, https://weread.test/reader');
    expect(block).toContain('browser_read_selection({ nodeId })');
  });
});
