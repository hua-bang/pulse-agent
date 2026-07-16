import { describe, expect, it } from 'vitest';
import { buildDockTabRefs, terminalSessionId } from './tabRefs';
import type { DockState } from './dock-store';

const baseState = (overrides: Partial<DockState>): DockState => ({
  tabs: [],
  activeTabId: 'chat',
  expanded: true,
  chatUnread: false,
  terminalTabsByWorkspace: {},
  activeTerminalWorkspaceId: '__default__',
  terminalTabs: [],
  activeTerminalTabId: undefined,
  nextTerminalOrdinal: 1,
  terminalOpen: false,
  ...overrides,
});

describe('terminalSessionId', () => {
  it('drops the ordinal suffix for the primary terminal tab', () => {
    expect(terminalSessionId('ws-1', 'terminal')).toBe('workspace-terminal:ws-1');
    expect(terminalSessionId('ws-1', 'terminal:2')).toBe('workspace-terminal:ws-1:terminal:2');
  });
});

describe('buildDockTabRefs', () => {
  it('projects link / artifact / node-detail preview tabs into refs', () => {
    const state = baseState({
      tabs: [
        { id: 'link:1', kind: 'link', title: 'Docs', url: 'https://x.dev' },
        { id: 'blank', kind: 'link', title: 'New tab', url: '' },
        { id: 'art', kind: 'artifact', title: 'Dash', workspaceId: 'ws-2', artifactId: 'a1' },
        { id: 'nd', kind: 'node-detail', title: 'Note', workspaceId: 'ws-2', nodeId: 'node-9' },
      ],
    });

    const refs = buildDockTabRefs(state, 'ws-1');
    // Blank link tab (no url) is skipped — nothing to read yet.
    expect(refs.map((r) => r.id)).toEqual(['link:1', 'art', 'nd']);
    expect(refs[0]).toMatchObject({ kind: 'link', url: 'https://x.dev', workspaceId: 'ws-1' });
    expect(refs[1]).toMatchObject({ kind: 'artifact', artifactId: 'a1', workspaceId: 'ws-2' });
    expect(refs[2]).toMatchObject({ kind: 'node-detail', nodeId: 'node-9', workspaceId: 'ws-2' });
  });

  it('includes only the given workspace terminal tabs, with resolved session ids', () => {
    const state = baseState({
      terminalTabsByWorkspace: {
        'ws-1': { tabs: [{ id: 'terminal', ordinal: 1 }, { id: 'terminal:2', ordinal: 2, title: 'Build' }], nextOrdinal: 3 },
        'ws-2': { tabs: [{ id: 'terminal', ordinal: 1 }], nextOrdinal: 2 },
      },
    });

    const refs = buildDockTabRefs(state, 'ws-1');
    expect(refs).toEqual([
      { id: 'terminal', kind: 'terminal', title: 'Terminal 1', workspaceId: 'ws-1', sessionId: 'workspace-terminal:ws-1' },
      { id: 'terminal:2', kind: 'terminal', title: 'Build', workspaceId: 'ws-1', sessionId: 'workspace-terminal:ws-1:terminal:2' },
    ]);
  });
});
