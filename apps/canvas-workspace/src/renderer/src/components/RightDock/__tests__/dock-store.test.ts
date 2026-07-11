import { describe, expect, it, vi } from 'vitest';
import { CHAT_TAB_ID, TERMINAL_TAB_ID, DockStore, artifactTabId, linkTabId, terminalTabId } from '../dock-store';

describe('DockStore', () => {
  it('starts collapsed on the pinned chat tab with no previews', () => {
    const dock = new DockStore();
    expect(dock.getSnapshot()).toEqual({
      tabs: [],
      activeTabId: CHAT_TAB_ID,
      expanded: false,
      chatUnread: false,
      terminalTabsByWorkspace: {},
      activeTerminalWorkspaceId: '__default__',
      terminalTabs: [],
      activeTerminalTabId: undefined,
      nextTerminalOrdinal: 1,
      terminalOpen: false,
    });
  });

  it('opening an artifact expands the dock and activates its new tab', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    const { tabs, activeTabId, expanded } = dock.getSnapshot();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ kind: 'artifact', workspaceId: 'ws1', artifactId: 'a1' });
    expect(activeTabId).toBe(artifactTabId('ws1', 'a1'));
    expect(expanded).toBe(true);
  });

  it('re-activates instead of duplicating an already-open artifact', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.openArtifact('ws1', 'a2');
    dock.openArtifact('ws1', 'a1');
    const { tabs, activeTabId } = dock.getSnapshot();
    expect(tabs).toHaveLength(2);
    expect(activeTabId).toBe(artifactTabId('ws1', 'a1'));
  });

  it('opens different URLs as separate link tabs', () => {
    const dock = new DockStore();
    dock.openLink('https://a.example');
    dock.openArtifact('ws1', 'a1');
    dock.openLink('https://b.example');
    const { tabs, activeTabId } = dock.getSnapshot();
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toMatchObject({
      id: linkTabId('https://a.example'),
      url: 'https://a.example',
      title: 'https://a.example',
    });
    expect(tabs[2]).toMatchObject({
      id: linkTabId('https://b.example'),
      url: 'https://b.example',
      title: 'https://b.example',
    });
    expect(activeTabId).toBe(linkTabId('https://b.example'));
  });

  it('re-opening the same URL activates the existing link tab and keeps its title', () => {
    const dock = new DockStore();
    const id = linkTabId('https://a.example');
    dock.openLink('https://a.example');
    dock.setTitle(id, 'Page title');
    dock.openArtifact('ws1', 'a1');
    dock.openLink('https://a.example');
    const { tabs, activeTabId } = dock.getSnapshot();
    expect(tabs).toHaveLength(2);
    expect(activeTabId).toBe(id);
    expect(tabs.find((t) => t.kind === 'link' && t.url === 'https://a.example')?.title).toBe('Page title');
  });

  it('creates independent blank web tabs and navigates one in place', () => {
    const dock = new DockStore();
    dock.newLink('New tab');
    const firstId = dock.getSnapshot().activeTabId;
    dock.newLink('New tab');
    const secondId = dock.getSnapshot().activeTabId;

    expect(firstId).not.toBe(secondId);
    expect(dock.getSnapshot().tabs).toMatchObject([
      { id: firstId, kind: 'link', title: 'New tab', url: '' },
      { id: secondId, kind: 'link', title: 'New tab', url: '' },
    ]);

    dock.navigateLink(firstId, 'https://example.com');
    expect(dock.getSnapshot().tabs[0]).toMatchObject({
      id: firstId,
      title: 'https://example.com',
      url: 'https://example.com',
    });
    expect(dock.getSnapshot().tabs[1]).toMatchObject({ id: secondId, url: '' });
  });

  it('activate switches between chat and previews and ignores unknown ids', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.activate(CHAT_TAB_ID);
    expect(dock.getSnapshot().activeTabId).toBe(CHAT_TAB_ID);
    dock.activate(artifactTabId('ws1', 'a1'));
    expect(dock.getSnapshot().activeTabId).toBe(artifactTabId('ws1', 'a1'));
    dock.activate('nope');
    expect(dock.getSnapshot().activeTabId).toBe(artifactTabId('ws1', 'a1'));
  });

  it('closing the active preview activates the right neighbour, falling back to chat', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.openArtifact('ws1', 'a2');
    dock.openArtifact('ws1', 'a3');
    dock.activate(artifactTabId('ws1', 'a2'));
    dock.close(artifactTabId('ws1', 'a2'));
    expect(dock.getSnapshot().activeTabId).toBe(artifactTabId('ws1', 'a3'));
    dock.close(artifactTabId('ws1', 'a3'));
    expect(dock.getSnapshot().activeTabId).toBe(artifactTabId('ws1', 'a1'));
    // Last preview gone → pinned chat becomes active again.
    dock.close(artifactTabId('ws1', 'a1'));
    const { tabs, activeTabId, expanded } = dock.getSnapshot();
    expect(tabs).toHaveLength(0);
    expect(activeTabId).toBe(CHAT_TAB_ID);
    expect(expanded).toBe(true);
  });

  it('closing an inactive preview keeps the active tab', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.openArtifact('ws1', 'a2');
    dock.close(artifactTabId('ws1', 'a1'));
    expect(dock.getSnapshot().activeTabId).toBe(artifactTabId('ws1', 'a2'));
  });

  it('collapse hides the dock but keeps all tabs and the active pointer', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.collapse();
    const { tabs, activeTabId, expanded } = dock.getSnapshot();
    expect(expanded).toBe(false);
    expect(tabs).toHaveLength(1);
    expect(activeTabId).toBe(artifactTabId('ws1', 'a1'));
  });

  it('toggleChat collapses only when chat is already the visible tab', () => {
    const dock = new DockStore();
    dock.toggleChat();
    expect(dock.getSnapshot()).toMatchObject({ expanded: true, activeTabId: CHAT_TAB_ID });
    dock.toggleChat();
    expect(dock.getSnapshot().expanded).toBe(false);
    // From a preview tab, toggleChat switches to chat instead of collapsing.
    dock.openArtifact('ws1', 'a1');
    dock.toggleChat();
    expect(dock.getSnapshot()).toMatchObject({ expanded: true, activeTabId: CHAT_TAB_ID });
  });

  it('opens and closes the workspace terminal as a pinned dock tab', () => {
    const dock = new DockStore();
    dock.openTerminal();
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: TERMINAL_TAB_ID,
      activeTerminalTabId: TERMINAL_TAB_ID,
      expanded: true,
      terminalOpen: true,
    });
    expect(dock.getSnapshot().terminalTabs[0]).toMatchObject({
      id: TERMINAL_TAB_ID,
      ordinal: 1,
    });
    dock.closeTerminal();
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: CHAT_TAB_ID,
      expanded: false,
      terminalOpen: false,
    });
  });

  it('closing the active terminal falls forward to a preview when present', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.openTerminal();
    dock.closeTerminal();
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: artifactTabId('ws1', 'a1'),
      expanded: true,
      terminalOpen: false,
    });
  });

  it('toggleTerminal hides and restores the active terminal without closing it', () => {
    const dock = new DockStore();
    dock.openTerminal();
    dock.toggleTerminal();
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: TERMINAL_TAB_ID,
      activeTerminalTabId: TERMINAL_TAB_ID,
      expanded: false,
      terminalOpen: true,
    });
    expect(dock.getSnapshot().terminalTabs).toHaveLength(1);
    dock.toggleTerminal();
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: TERMINAL_TAB_ID,
      expanded: true,
      terminalOpen: true,
    });
  });

  it('creates multiple terminal tabs and closes only the requested one', () => {
    const dock = new DockStore();
    dock.openTerminal();
    dock.newTerminal();
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: terminalTabId(2),
      activeTerminalTabId: terminalTabId(2),
      expanded: true,
      terminalOpen: true,
    });
    expect(dock.getSnapshot().terminalTabs.map((tab) => tab.id)).toEqual([
      TERMINAL_TAB_ID,
      terminalTabId(2),
    ]);
    dock.closeTerminal(terminalTabId(2));
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: TERMINAL_TAB_ID,
      activeTerminalTabId: TERMINAL_TAB_ID,
      terminalOpen: true,
    });
    dock.closeTerminal(TERMINAL_TAB_ID);
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: CHAT_TAB_ID,
      activeTerminalTabId: undefined,
      expanded: false,
      terminalOpen: false,
    });
  });

  it('keeps terminal tabs scoped to the active workspace', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('ws-a');
    dock.openTerminal();
    dock.renameTerminal(TERMINAL_TAB_ID, 'Claude');
    dock.newTerminal();
    dock.renameTerminal(terminalTabId(2), 'Codex');

    expect(dock.getSnapshot()).toMatchObject({
      activeTerminalWorkspaceId: 'ws-a',
      activeTabId: terminalTabId(2),
      activeTerminalTabId: terminalTabId(2),
      terminalOpen: true,
    });
    expect(dock.getSnapshot().terminalTabs.map((tab) => tab.title)).toEqual(['Claude', 'Codex']);

    dock.setActiveWorkspace('ws-b');
    expect(dock.getSnapshot()).toMatchObject({
      activeTerminalWorkspaceId: 'ws-b',
      activeTabId: CHAT_TAB_ID,
      activeTerminalTabId: undefined,
      expanded: true,
      terminalOpen: false,
      terminalTabs: [],
      nextTerminalOrdinal: 1,
    });

    dock.openTerminal();
    expect(dock.getSnapshot().terminalTabs).toEqual([{ id: TERMINAL_TAB_ID, ordinal: 1 }]);

    dock.setActiveWorkspace('ws-a');
    expect(dock.getSnapshot()).toMatchObject({
      activeTerminalWorkspaceId: 'ws-a',
      activeTabId: terminalTabId(2),
      activeTerminalTabId: terminalTabId(2),
      terminalOpen: true,
    });
    expect(dock.getSnapshot().terminalTabs.map((tab) => tab.title)).toEqual(['Claude', 'Codex']);
  });

  it('stores terminal agent type per workspace tab', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('ws-a');
    dock.openTerminal();
    dock.setTerminalAgentType(TERMINAL_TAB_ID, 'claude-code', 'ws-a');
    dock.newTerminal();
    dock.setTerminalAgentType(terminalTabId(2), 'codex', 'ws-a');

    expect(dock.getSnapshot().terminalTabs.map((tab) => tab.agentType)).toEqual(['claude-code', 'codex']);

    dock.setActiveWorkspace('ws-b');
    dock.openTerminal();
    dock.setTerminalAgentType(TERMINAL_TAB_ID, 'codex', 'ws-b');
    expect(dock.getSnapshot().terminalTabs[0]).toMatchObject({ agentType: 'codex' });

    dock.setActiveWorkspace('ws-a');
    expect(dock.getSnapshot().terminalTabs.map((tab) => tab.agentType)).toEqual(['claude-code', 'codex']);
    dock.setTerminalAgentType(terminalTabId(2), undefined, 'ws-a');
    expect(dock.getSnapshot().terminalTabs.map((tab) => tab.agentType)).toEqual(['claude-code', undefined]);
  });

  it('renames terminal tabs and ignores blanks or non-terminal ids', () => {
    const dock = new DockStore();
    dock.openTerminal();
    dock.renameTerminal(TERMINAL_TAB_ID, ' server ');
    expect(dock.getSnapshot().terminalTabs[0]).toMatchObject({
      id: TERMINAL_TAB_ID,
      title: 'server',
      ordinal: 1,
    });
    dock.renameTerminal(TERMINAL_TAB_ID, '   ');
    expect(dock.getSnapshot().terminalTabs[0].title).toBe('server');
    dock.openArtifact('ws1', 'a1');
    dock.renameTerminal(artifactTabId('ws1', 'a1'), 'artifact title');
    expect(dock.getSnapshot().tabs[0].title).toBe('Artifact');
  });

  it('chat activity sets unread only while chat is not the visible tab', () => {
    const dock = new DockStore();
    dock.openChat();
    dock.notifyChatActivity();
    expect(dock.getSnapshot().chatUnread).toBe(false);
    dock.openArtifact('ws1', 'a1');
    dock.notifyChatActivity();
    expect(dock.getSnapshot().chatUnread).toBe(true);
    // Viewing chat clears the dot.
    dock.activate(CHAT_TAB_ID);
    expect(dock.getSnapshot().chatUnread).toBe(false);
    // Also set while collapsed (reply arrives with the panel hidden).
    dock.collapse();
    dock.notifyChatActivity();
    expect(dock.getSnapshot().chatUnread).toBe(true);
    dock.openChat();
    expect(dock.getSnapshot().chatUnread).toBe(false);
  });

  it('closing the active preview back to chat clears unread', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.notifyChatActivity();
    expect(dock.getSnapshot().chatUnread).toBe(true);
    dock.close(artifactTabId('ws1', 'a1'));
    expect(dock.getSnapshot()).toMatchObject({ activeTabId: CHAT_TAB_ID, chatUnread: false });
  });

  it('setTitle updates a preview label and ignores blank titles', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    const id = artifactTabId('ws1', 'a1');
    dock.setTitle(id, '进店意图 SQL 加工逻辑');
    expect(dock.getSnapshot().tabs[0].title).toBe('进店意图 SQL 加工逻辑');
    dock.setTitle(id, '   ');
    expect(dock.getSnapshot().tabs[0].title).toBe('进店意图 SQL 加工逻辑');
  });

  it('setFavicon stores a link icon, ignores blanks, and skips non-link tabs', () => {
    const dock = new DockStore();
    dock.openLink('https://a.example');
    const id = linkTabId('https://a.example');
    dock.setFavicon(id, 'https://a.example/favicon.ico');
    const tab = dock.getSnapshot().tabs[0];
    expect(tab.kind === 'link' && tab.faviconUrl).toBe('https://a.example/favicon.ico');
    // Blank favicons are ignored.
    dock.setFavicon(id, '   ');
    const afterBlank = dock.getSnapshot().tabs[0];
    expect(afterBlank.kind === 'link' && afterBlank.faviconUrl).toBe('https://a.example/favicon.ico');
    // Non-link tabs never gain a favicon.
    dock.openArtifact('ws1', 'a1');
    const artifactId = artifactTabId('ws1', 'a1');
    dock.setFavicon(artifactId, 'https://x.example/icon.png');
    expect(dock.getSnapshot().tabs.find((t) => t.id === artifactId)).not.toHaveProperty('faviconUrl');
  });

  it('notifies subscribers on change, skips no-ops, and stops after unsubscribe', () => {
    const dock = new DockStore();
    const listener = vi.fn();
    const unsubscribe = dock.subscribe(listener);
    dock.openArtifact('ws1', 'a1');
    expect(listener).toHaveBeenCalledTimes(1);
    // No-op operations must not notify (snapshot identity is the contract
    // useSyncExternalStore relies on).
    dock.activate(artifactTabId('ws1', 'a1'));
    dock.collapse(); // expanded → false
    expect(listener).toHaveBeenCalledTimes(2);
    dock.collapse(); // already collapsed → no-op
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    dock.openChat();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
