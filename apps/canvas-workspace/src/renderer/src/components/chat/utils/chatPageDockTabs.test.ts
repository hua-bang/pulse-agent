import { describe, expect, it } from 'vitest';
import type { DockState } from '../../dock/RightDock/dock-store';
import { buildChatPageDockTabRefs } from './chatPageDockTabs';

const state = (overrides: Partial<DockState> = {}): DockState => ({
  tabs: [],
  retainedLinkTabs: [],
  activeTabId: 'chat',
  expanded: false,
  chatUnread: false,
  terminalTabsByWorkspace: {},
  activeTerminalWorkspaceId: 'workspace-live',
  terminalTabs: [],
  activeTerminalTabId: undefined,
  nextTerminalOrdinal: 1,
  terminalOpen: false,
  mountedWorkspaceIds: new Set(),
  ...overrides,
});

describe('buildChatPageDockTabRefs', () => {
  it('offers the current RightDock tabs to full-page global chat with their real dock workspace', () => {
    expect(buildChatPageDockTabRefs(state({
      tabs: [{
        id: 'link:docs',
        kind: 'link',
        title: 'Product docs',
        url: 'https://example.com/docs',
      }],
      activeTabId: 'link:docs',
      expanded: true,
    }))).toEqual([expect.objectContaining({
      id: 'link:docs',
      workspaceId: 'workspace-live',
      dockWorkspaceId: 'workspace-live',
      isActive: true,
      isVisible: true,
    })]);
  });

  it('does not invent candidates before the dock has a real workspace', () => {
    expect(buildChatPageDockTabRefs(state({
      activeTerminalWorkspaceId: '__default__',
    }))).toEqual([]);
  });
});
