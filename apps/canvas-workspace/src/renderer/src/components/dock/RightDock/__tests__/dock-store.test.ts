import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_TAB_ID,
  TERMINAL_TAB_ID,
  DockStore,
  artifactTabId,
  canvasPreviewTabId,
  linkTabId,
  nodeDetailTabId,
  skillTabId,
  terminalTabId,
  type DockLinkSessions,
  type DockSessionPersistence,
} from '../dock-store';

const createSessionPersistence = (initial: DockLinkSessions = {}): {
  persistence: DockSessionPersistence;
  read: () => DockLinkSessions;
} => {
  let sessions = structuredClone(initial);
  return {
    persistence: {
      load: () => structuredClone(sessions),
      save: (next) => { sessions = structuredClone(next); },
    },
    read: () => structuredClone(sessions),
  };
};

describe('DockStore', () => {
  it('starts collapsed on the pinned chat tab with no previews', () => {
    const dock = new DockStore();
    expect(dock.getSnapshot()).toEqual({
      tabs: [],
      retainedLinkTabs: [],
      activeTabId: CHAT_TAB_ID,
      expanded: false,
      chatUnread: false,
      terminalTabsByWorkspace: {},
      activeTerminalWorkspaceId: '__default__',
      terminalTabs: [],
      activeTerminalTabId: undefined,
      nextTerminalOrdinal: 1,
      terminalOpen: false,
      mountedWorkspaceIds: new Set(),
    });
  });

  it('opens a scheduled task in Pulse AI and returns to workspace chat', () => {
    const dock = new DockStore();

    dock.openScheduledChat('daily-brief');
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: CHAT_TAB_ID,
      expanded: true,
      scheduledChatTaskId: 'daily-brief',
      scheduledChatRevision: 1,
    });

    dock.refreshScheduledChat('daily-brief');
    expect(dock.getSnapshot().scheduledChatRevision).toBe(2);

    dock.openChat();
    expect(dock.getSnapshot().scheduledChatTaskId).toBeUndefined();
  });

  it('refuses to preview a workspace that is already mounted in the main canvas', () => {
    const dock = new DockStore();
    dock.setMountedWorkspaces(['ws1']);
    dock.openCanvasPreview('ws1', 'Research');
    expect(dock.getSnapshot().tabs).toHaveLength(0);
    expect(dock.canPreviewCanvas('ws1')).toBe(false);
    expect(dock.canPreviewCanvas('ws2')).toBe(true);
  });

  it('closes an open canvas preview when its workspace becomes mounted', () => {
    const dock = new DockStore();
    dock.openCanvasPreview('ws1', 'Research');
    dock.openCanvasPreview('ws2', 'Product');
    // ws1 gets mounted by the main Workbench (e.g. user switches to it).
    dock.setMountedWorkspaces(['ws1']);
    expect(dock.getSnapshot().tabs.map((tab) => tab.id)).toEqual([canvasPreviewTabId('ws2')]);
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

  it('opening a canvas preview expands the dock and activates its new tab', () => {
    const dock = new DockStore();
    dock.openCanvasPreview('ws1', 'Research');
    const { tabs, activeTabId, expanded } = dock.getSnapshot();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ kind: 'canvas', workspaceId: 'ws1', title: 'Research' });
    expect(activeTabId).toBe(canvasPreviewTabId('ws1'));
    expect(expanded).toBe(true);
  });

  it('re-activates and re-titles instead of duplicating an open canvas preview', () => {
    const dock = new DockStore();
    dock.openCanvasPreview('ws1', 'Research');
    dock.openCanvasPreview('ws2', 'Product');
    dock.openCanvasPreview('ws1', 'Research (renamed)');
    const { tabs, activeTabId } = dock.getSnapshot();
    expect(tabs).toHaveLength(2);
    expect(activeTabId).toBe(canvasPreviewTabId('ws1'));
    expect(tabs.find((tab) => tab.id === canvasPreviewTabId('ws1'))).toMatchObject({
      title: 'Research (renamed)',
    });
  });

  it('closes a canvas preview by its id (used when its workspace becomes active)', () => {
    const dock = new DockStore();
    dock.openCanvasPreview('ws1', 'Research');
    dock.openCanvasPreview('ws2', 'Product');
    dock.close(canvasPreviewTabId('ws1'));
    const { tabs } = dock.getSnapshot();
    expect(tabs.map((tab) => tab.id)).toEqual([canvasPreviewTabId('ws2')]);
    // Closing a workspace with no preview tab is a safe no-op.
    dock.close(canvasPreviewTabId('nope'));
    expect(dock.getSnapshot().tabs).toHaveLength(1);
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

  it('promotes a node detail into one deduplicated dock tab', () => {
    const dock = new DockStore();
    dock.openNodeDetail('ws1', 'node1', 'Search & RSS');
    dock.openArtifact('ws1', 'a1');
    dock.openNodeDetail('ws1', 'node1', 'Updated title');

    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: nodeDetailTabId('ws1', 'node1'),
      expanded: true,
    });
    expect(dock.getSnapshot().tabs.filter((tab) => tab.kind === 'node-detail')).toEqual([
      expect.objectContaining({
        workspaceId: 'ws1',
        nodeId: 'node1',
        title: 'Updated title',
      }),
    ]);
  });

  it('yields the dock to a full-page node detail without discarding other tabs', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.openNodeDetail('ws1', 'node1', 'Search & RSS');

    dock.enterNodePage('ws1', 'node1');

    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: artifactTabId('ws1', 'a1'),
      expanded: false,
    });
    expect(dock.getSnapshot().tabs).toEqual([
      expect.objectContaining({ id: artifactTabId('ws1', 'a1') }),
    ]);
  });

  it('keeps an unrelated active dock tab visible when a node page opens directly', () => {
    const dock = new DockStore();
    dock.openNodeDetail('ws1', 'node1', 'Search & RSS');
    dock.openArtifact('ws1', 'a1');

    dock.enterNodePage('ws1', 'node1');

    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: artifactTabId('ws1', 'a1'),
      expanded: true,
    });
    expect(dock.getSnapshot().tabs).toEqual([
      expect.objectContaining({ id: artifactTabId('ws1', 'a1') }),
    ]);
  });

  it('opens and refreshes one Skill detail tab per scope', () => {
    const dock = new DockStore();
    const scope = { level: 'workspace', workspaceId: 'ws1' } as const;
    const skill = {
      name: 'release-canvas',
      description: 'Prepare a release.',
      body: 'Validate.',
      scope: 'workspace' as const,
      path: '/skills/release-canvas/SKILL.md',
      source: 'canvas' as const,
      writable: true,
    };

    dock.openSkill(scope, skill);
    dock.openSkill(scope, { ...skill, description: 'Updated description.' });

    expect(dock.getSnapshot().tabs).toHaveLength(1);
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: skillTabId('ws1', skill.name),
      expanded: true,
    });
    expect(dock.getSnapshot().tabs[0]).toMatchObject({
      kind: 'skill',
      skill: { description: 'Updated description.' },
    });
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

  it('opens a background link without moving the user off the current tab', () => {
    // ⌘/Ctrl+click and middle-click mean "queue this"; foregrounding them
    // yanks the user off the page they were reading.
    const dock = new DockStore();
    dock.openLink('https://a.example');
    const firstId = dock.getSnapshot().activeTabId;

    dock.openLink('https://b.example', { background: true });
    const { tabs, activeTabId, expanded } = dock.getSnapshot();

    expect(tabs).toHaveLength(2);
    expect(activeTabId).toBe(firstId);
    expect(expanded).toBe(true);
  });

  it('places a link opened from a tab next to its opener, in click order', () => {
    const dock = new DockStore();
    dock.openLink('https://source.example');
    const openerTabId = dock.getSnapshot().activeTabId;
    dock.openLink('https://unrelated.example');

    dock.openLink('https://child-1.example', { background: true, openerTabId });
    dock.openLink('https://child-2.example', { background: true, openerTabId });

    expect(dock.getSnapshot().tabs.map((tab) => (tab.kind === 'link' ? tab.url : tab.id))).toEqual([
      'https://source.example',
      'https://child-1.example',
      'https://child-2.example',
      'https://unrelated.example',
    ]);
  });

  it('keeps the favicon across same-origin navigation and drops it across origins', () => {
    // SPA route changes fire syncLinkUrl on every pushState but re-announce
    // page-favicon-updated only when the icon link actually changes — so
    // clearing unconditionally stranded those tabs on the generic globe.
    const dock = new DockStore();
    dock.openLink('https://app.example/docs');
    const id = dock.getSnapshot().activeTabId;
    dock.setFavicon(id, 'https://app.example/icon.png');

    dock.syncLinkUrl(id, 'https://app.example/docs/page-2?view=grid');
    expect(dock.getSnapshot().tabs[0]).toMatchObject({
      url: 'https://app.example/docs/page-2?view=grid',
      faviconUrl: 'https://app.example/icon.png',
    });

    dock.syncLinkUrl(id, 'https://other.example/');
    expect((dock.getSnapshot().tabs[0] as { faviconUrl?: string }).faviconUrl).toBeUndefined();
  });

  it('restores a closed web tab at its old position, most recent first', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('ws1');
    dock.openLink('https://a.example');
    dock.openLink('https://b.example');
    dock.openLink('https://c.example');
    const middleId = dock.getSnapshot().tabs[1].id;

    expect(dock.canReopenClosedTab()).toBe(false);
    dock.close(middleId);
    expect(dock.getSnapshot().tabs).toHaveLength(2);
    expect(dock.canReopenClosedTab()).toBe(true);

    dock.reopenClosedTab();
    const { tabs, activeTabId } = dock.getSnapshot();
    expect(tabs.map((tab) => (tab.kind === 'link' ? tab.url : tab.id))).toEqual([
      'https://a.example',
      'https://b.example',
      'https://c.example',
    ]);
    expect(activeTabId).toBe(middleId);
    expect(dock.canReopenClosedTab()).toBe(false);
  });

  it('restores a closed URL with a unique id when that URL was opened again', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('ws1');
    dock.openLink('https://a.example');
    const closedId = dock.getSnapshot().activeTabId;

    dock.close(closedId);
    dock.openLink('https://a.example');
    const replacementId = dock.getSnapshot().activeTabId;
    dock.reopenClosedTab();

    const restoredTabs = dock.getSnapshot().tabs;
    expect(restoredTabs).toHaveLength(2);
    expect(new Set(restoredTabs.map((tab) => tab.id))).toHaveLength(2);

    const restoredId = restoredTabs.find((tab) => tab.id !== replacementId)?.id;
    if (!restoredId) throw new Error('Expected the restored tab to have a collision-safe id');
    dock.navigateLink(restoredId, 'https://restored.example');
    expect(dock.getSnapshot().tabs).toMatchObject([
      { id: restoredId, url: 'https://restored.example' },
      { id: replacementId, url: 'https://a.example' },
    ]);

    dock.close(restoredId);
    expect(dock.getSnapshot().tabs).toMatchObject([
      { id: replacementId, url: 'https://a.example' },
    ]);
  });

  it('never resurfaces a closed tab in a different workspace', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('ws1');
    dock.openLink('https://a.example');
    dock.close(dock.getSnapshot().activeTabId);

    dock.setActiveWorkspace('ws2');
    expect(dock.canReopenClosedTab()).toBe(false);
    dock.reopenClosedTab();
    expect(dock.getSnapshot().tabs).toHaveLength(0);

    dock.setActiveWorkspace('ws1');
    expect(dock.canReopenClosedTab()).toBe(true);
  });

  it('retains the left workspace\'s web tabs, and hands them back on return', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('ws1');
    dock.openLink('https://a.example/');
    dock.openLink('https://b.example/');

    dock.setActiveWorkspace('ws2');
    const away = dock.getSnapshot();
    // Out of the strip, but still held so their guests stay mounted.
    expect(away.tabs.filter((tab) => tab.kind === 'link')).toHaveLength(0);
    expect(away.retainedLinkTabs).toHaveLength(1);
    expect(away.retainedLinkTabs[0].workspaceId).toBe('ws1');
    expect(away.retainedLinkTabs[0].tabs.map((tab) => tab.url)).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);

    dock.setActiveWorkspace('ws1');
    const back = dock.getSnapshot();
    expect(back.tabs.map((tab) => (tab.kind === 'link' ? tab.url : tab.id))).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
    // No longer retained — it is live again.
    expect(back.retainedLinkTabs).toHaveLength(0);
  });

  it('remembers whether the dock is expanded independently for each workspace', () => {
    const dock = new DockStore();

    dock.setActiveWorkspace('ws-a');
    dock.openChat();
    expect(dock.getSnapshot().expanded).toBe(true);

    dock.setActiveWorkspace('ws-b');
    expect(dock.getSnapshot().expanded).toBe(false);

    dock.openChat();
    dock.setActiveWorkspace('ws-a');
    expect(dock.getSnapshot().expanded).toBe(true);

    dock.collapse();
    dock.setActiveWorkspace('ws-b');
    expect(dock.getSnapshot().expanded).toBe(true);

    dock.setActiveWorkspace('ws-a');
    expect(dock.getSnapshot().expanded).toBe(false);
  });

  it('restores a workspace dock expansion after restarting the store', () => {
    const saved = createSessionPersistence();
    const firstRun = new DockStore(saved.persistence);
    firstRun.setActiveWorkspace('ws-a');
    firstRun.openChat();

    const restored = new DockStore(saved.persistence);
    restored.setActiveWorkspace('ws-a');
    expect(restored.getSnapshot().expanded).toBe(true);

    restored.collapse();
    const restoredAgain = new DockStore(saved.persistence);
    restoredAgain.setActiveWorkspace('ws-a');
    expect(restoredAgain.getSnapshot().expanded).toBe(false);
  });

  it('restores a hidden tab at the URL it navigated to, not the one it left at', () => {
    // `useEmbeddedBrowser` treats a stored URL that differs from the live
    // guest as a navigation COMMAND, so a stale record would yank a
    // background-navigated page back — the state loss retention exists to
    // prevent.
    const { persistence, read } = createSessionPersistence();
    const dock = new DockStore(persistence);
    dock.setActiveWorkspace('ws1');
    dock.openLink('https://app.example/inbox');
    const tabId = dock.getSnapshot().activeTabId;

    dock.setActiveWorkspace('ws2');
    dock.updateRetainedLinkTab('ws1', tabId, { url: 'https://app.example/thread/42' });

    dock.setActiveWorkspace('ws1');
    expect(dock.getSnapshot().tabs[0]).toMatchObject({
      id: tabId,
      url: 'https://app.example/thread/42',
    });
    // …and it survives a restart, not just the switch back.
    expect(read().ws1.tabs[0].url).toBe('https://app.example/thread/42');
  });

  it('ignores a retained update aimed at a workspace that is not retained', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('ws1');
    dock.openLink('https://a.example/');
    const tabId = dock.getSnapshot().activeTabId;
    const before = dock.getSnapshot();

    // ws1 is LIVE, not retained — this must not touch the visible tab.
    dock.updateRetainedLinkTab('ws1', tabId, { url: 'https://hijacked.example/' });

    expect(dock.getSnapshot()).toBe(before);
  });

  it('routes a retained guest new tab back to its owning workspace', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('ws-a');
    dock.openLink('https://a.example/');
    const openerId = dock.getSnapshot().activeTabId;

    dock.setActiveWorkspace('ws-b');
    dock.openLink('https://b.example/');
    const visibleTabsBefore = dock.getSnapshot().tabs;

    dock.openLinkInWorkspace('ws-a', 'https://popup.example/', { openerTabId: openerId });

    expect(dock.getSnapshot().activeTerminalWorkspaceId).toBe('ws-b');
    expect(dock.getSnapshot().tabs).toEqual(visibleTabsBefore);
    expect(dock.getSnapshot().retainedLinkTabs).toMatchObject([{
      workspaceId: 'ws-a',
      activeTabId: openerId,
      tabs: [
        { id: openerId, url: 'https://a.example/' },
        { url: 'https://popup.example/' },
      ],
    }]);

    dock.setActiveWorkspace('ws-a');
    expect(dock.getSnapshot().tabs).toMatchObject([
      { id: openerId, url: 'https://a.example/' },
      { url: 'https://popup.example/' },
    ]);
    expect(dock.getSnapshot().activeTabId).toBe(openerId);
  });

  it('persists a link opened by an inactive workspace even without a retained browser tab', () => {
    const saved = createSessionPersistence();
    const dock = new DockStore(saved.persistence);
    dock.setActiveWorkspace('ws-a');
    dock.setActiveWorkspace('ws-b');

    dock.openLinkInWorkspace('ws-a', 'https://from-canvas-node.example/');

    expect(dock.getSnapshot().activeTerminalWorkspaceId).toBe('ws-b');
    expect(dock.getSnapshot().tabs).toHaveLength(0);
    dock.setActiveWorkspace('ws-a');
    expect(dock.getSnapshot().tabs).toMatchObject([
      { kind: 'link', url: 'https://from-canvas-node.example/' },
    ]);
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

  it('keeps a resolved page title when the guest reports its final URL', () => {
    const dock = new DockStore();
    dock.openLink('https://github.com');
    const id = linkTabId('https://github.com');
    dock.setTitle(id, 'GitHub · Change is constant. GitHub keeps you ahead.');

    dock.syncLinkUrl(id, 'https://github.com/');

    expect(dock.getSnapshot().tabs[0]).toMatchObject({
      id,
      url: 'https://github.com/',
      title: 'GitHub · Change is constant. GitHub keeps you ahead.',
    });
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

  it('opens comparison with Pulse AI, then replaces the focused pane with any dock tab', () => {
    const dock = new DockStore();
    dock.openLink('https://a.example');
    const linkId = linkTabId('https://a.example');

    dock.toggleSplitView();
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: linkId,
      splitTabIds: [linkId, CHAT_TAB_ID],
      expanded: true,
    });

    dock.activate(CHAT_TAB_ID);
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: CHAT_TAB_ID,
      splitTabIds: [linkId, CHAT_TAB_ID],
    });

    dock.openArtifact('ws1', 'a1');
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: artifactTabId('ws1', 'a1'),
      splitTabIds: [linkId, artifactTabId('ws1', 'a1')],
    });

    // Focusing the already-visible left pane chooses which side the next tab
    // replaces; it must not move either visible tab by itself.
    dock.activate(linkId);
    expect(dock.getSnapshot().splitTabIds).toEqual([linkId, artifactTabId('ws1', 'a1')]);
    dock.openNodeDetail('ws1', 'node-1', 'Node one');
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: nodeDetailTabId('ws1', 'node-1'),
      splitTabIds: [nodeDetailTabId('ws1', 'node-1'), artifactTabId('ws1', 'a1')],
    });

    dock.toggleSplitView();
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: nodeDetailTabId('ws1', 'node-1'),
    });
    expect(dock.getSnapshot().splitTabIds).toBeUndefined();
  });

  it('enters comparison from any non-chat tab and collapses when either visible tab closes', () => {
    const dock = new DockStore();
    dock.toggleSplitView();
    expect(dock.getSnapshot().splitTabIds).toBeUndefined();

    dock.openArtifact('ws1', 'a1');
    dock.toggleSplitView();
    expect(dock.getSnapshot().splitTabIds).toEqual([artifactTabId('ws1', 'a1'), CHAT_TAB_ID]);
    dock.close(artifactTabId('ws1', 'a1'));
    expect(dock.getSnapshot()).toMatchObject({ activeTabId: CHAT_TAB_ID });
    expect(dock.getSnapshot().splitTabIds).toBeUndefined();

    dock.openTerminal();
    dock.toggleSplitView();
    expect(dock.getSnapshot().splitTabIds).toEqual([TERMINAL_TAB_ID, CHAT_TAB_ID]);

    dock.closeTerminal();
    expect(dock.getSnapshot().splitTabIds).toBeUndefined();
  });

  it('replaces an already-visible terminal instead of creating a two-terminal comparison', () => {
    const dock = new DockStore();
    dock.openTerminal();
    dock.toggleSplitView();
    dock.activate(CHAT_TAB_ID);

    dock.newTerminal();

    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: 'terminal:2',
      splitTabIds: ['terminal:2', CHAT_TAB_ID],
    });
  });

  it('replaces the stale workspace pane instead of the focused chat pane on workspace switch', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('ws-2');
    dock.openLink('https://two.example');
    const workspaceTwoLinkId = linkTabId('https://two.example');
    dock.setActiveWorkspace('ws-1');
    dock.openLink('https://one.example');
    dock.toggleSplitView();
    dock.activate(CHAT_TAB_ID);

    dock.setActiveWorkspace('ws-2');

    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: workspaceTwoLinkId,
      splitTabIds: [workspaceTwoLinkId, CHAT_TAB_ID],
    });
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

  it('reorders preview tabs before or after a drop target without changing the active tab', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.openArtifact('ws1', 'a2');
    dock.openArtifact('ws1', 'a3');
    const first = artifactTabId('ws1', 'a1');
    const second = artifactTabId('ws1', 'a2');
    const third = artifactTabId('ws1', 'a3');

    dock.reorderTab(first, third, 'after');
    expect(dock.getSnapshot().tabs.map((tab) => tab.id)).toEqual([second, third, first]);
    expect(dock.getSnapshot().activeTabId).toBe(third);

    dock.reorderTab(first, second, 'before');
    expect(dock.getSnapshot().tabs.map((tab) => tab.id)).toEqual([first, second, third]);
  });

  it('persists the reordered browser-tab session', () => {
    const saved = createSessionPersistence();
    const dock = new DockStore(saved.persistence);
    dock.setActiveWorkspace('ws-a');
    dock.openLink('https://a.example');
    dock.openLink('https://b.example');
    dock.openLink('https://c.example');

    dock.reorderTab(
      linkTabId('https://c.example'),
      linkTabId('https://a.example'),
      'before',
    );

    expect(saved.read()['ws-a'].tabs.map((tab) => tab.url)).toEqual([
      'https://c.example',
      'https://a.example',
      'https://b.example',
    ]);
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

  it('reorders terminal tabs within the active workspace', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('ws-a');
    dock.openTerminal();
    dock.newTerminal();
    dock.newTerminal();

    dock.reorderTab(terminalTabId(3), TERMINAL_TAB_ID, 'before');
    expect(dock.getSnapshot().terminalTabs.map((tab) => tab.id)).toEqual([
      terminalTabId(3),
      TERMINAL_TAB_ID,
      terminalTabId(2),
    ]);
    expect(dock.getSnapshot().activeTerminalTabId).toBe(terminalTabId(3));

    dock.setActiveWorkspace('ws-b');
    dock.setActiveWorkspace('ws-a');
    expect(dock.getSnapshot().terminalTabs.map((tab) => tab.id)).toEqual([
      terminalTabId(3),
      TERMINAL_TAB_ID,
      terminalTabId(2),
    ]);
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
      expanded: false,
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

  it('restores persisted web tabs and the last active tab per workspace', () => {
    const saved = createSessionPersistence();
    const firstRun = new DockStore(saved.persistence);
    firstRun.setActiveWorkspace('ws-a');
    firstRun.openLink('https://a.example');
    firstRun.openLink('https://b.example');
    firstRun.activate(linkTabId('https://a.example'));

    firstRun.setActiveWorkspace('ws-b');
    firstRun.openLink('https://other.example');

    const restored = new DockStore(saved.persistence);
    restored.setActiveWorkspace('ws-a');
    expect(restored.getSnapshot()).toMatchObject({
      activeTabId: linkTabId('https://a.example'),
      expanded: true,
    });
    expect(restored.getSnapshot().tabs).toMatchObject([
      { kind: 'link', url: 'https://a.example' },
      { kind: 'link', url: 'https://b.example' },
    ]);

    restored.setActiveWorkspace('ws-b');
    expect(restored.getSnapshot().tabs).toMatchObject([
      { kind: 'link', url: 'https://other.example' },
    ]);
    expect(restored.getSnapshot().activeTabId).toBe(linkTabId('https://other.example'));
  });

  it('keeps the last active web tab when a transient preview becomes active', () => {
    const saved = createSessionPersistence();
    const firstRun = new DockStore(saved.persistence);
    firstRun.setActiveWorkspace('ws-a');
    firstRun.openLink('https://a.example');
    firstRun.openLink('https://b.example');
    firstRun.openArtifact('ws-a', 'artifact-1');

    const restored = new DockStore(saved.persistence);
    restored.setActiveWorkspace('ws-a');

    expect(restored.getSnapshot().activeTabId).toBe(linkTabId('https://b.example'));

    restored.openArtifact('ws-a', 'artifact-2');
    restored.close(linkTabId('https://b.example'));
    const afterClosingLink = new DockStore(saved.persistence);
    afterClosingLink.setActiveWorkspace('ws-a');
    expect(afterClosingLink.getSnapshot().activeTabId).toBe(linkTabId('https://a.example'));
  });

  it('persists web-tab navigation metadata and removes closed tabs from the saved session', () => {
    const saved = createSessionPersistence();
    const dock = new DockStore(saved.persistence);
    dock.setActiveWorkspace('ws-a');
    dock.newLink('New tab');
    const id = dock.getSnapshot().activeTabId;
    dock.navigateLink(id, 'https://example.com');
    dock.setTitle(id, 'Example');
    dock.setFavicon(id, 'https://example.com/favicon.ico');

    expect(saved.read()['ws-a']).toEqual({
      tabs: [{
        id,
        kind: 'link',
        title: 'Example',
        url: 'https://example.com',
        faviconUrl: 'https://example.com/favicon.ico',
      }],
      activeTabId: id,
      expanded: true,
    });

    dock.close(id);
    expect(saved.read()['ws-a']).toEqual({ tabs: [], activeTabId: undefined, expanded: true });
  });

  it('persists dock expansion without persisting transient non-web previews', () => {
    const saved = createSessionPersistence();
    const dock = new DockStore(saved.persistence);
    dock.setActiveWorkspace('ws-a');
    dock.openArtifact('ws-a', 'artifact-1');
    dock.openNodeDetail('ws-a', 'node-1', 'Node');
    dock.openCanvasPreview('ws-b', 'Other workspace');

    expect(saved.read()).toEqual({
      'ws-a': { tabs: [], activeTabId: undefined, expanded: true },
    });
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

  it('does not mark chat unread while it is visible beside a split content tab', () => {
    const dock = new DockStore();
    dock.openLink('https://a.example');
    dock.toggleSplitView();
    dock.notifyChatActivity();
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
