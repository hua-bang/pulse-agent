import { describe, expect, it } from 'vitest';
import { GLOBAL_CHAT_STORE_ID } from '../../../../../../../shared/agent-chat';
import { CHAT_TAB_ID, DockStore } from '../dock-store';
import { createDockSessionPersistence } from '../dock-session-persistence';

const globalId = GLOBAL_CHAT_STORE_ID;

describe('scope-owned Dock sessions', () => {
  it('isolates Global, A and B, restoring mixed order, selected previews and expansion', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('a');
    dock.openLink('https://a.example');
    dock.openArtifact('b', 'artifact-from-b');
    dock.openLink('https://second-a.example');
    const aTabs = dock.getSnapshot().tabs;
    dock.activate(aTabs[1].id);
    dock.collapse();

    dock.setActiveWorkspace(globalId);
    expect(dock.getSnapshot()).toMatchObject({ tabs: [], expanded: false });
    dock.openLink('https://global.example');
    dock.openNodeDetail('b', 'node-from-b', 'Cross-scope preview');
    const globalTabs = dock.getSnapshot().tabs;
    const globalActive = dock.getSnapshot().activeTabId;

    dock.setActiveWorkspace('b');
    expect(dock.getSnapshot()).toMatchObject({ tabs: [], expanded: false });
    dock.openLink('https://b.example');

    dock.setActiveWorkspace('a');
    expect(dock.getSnapshot()).toMatchObject({ tabs: aTabs, activeTabId: aTabs[1].id, expanded: false });
    dock.setActiveWorkspace(globalId);
    expect(dock.getSnapshot()).toMatchObject({ tabs: globalTabs, activeTabId: globalActive, expanded: true });
  });

  it('restores Pulse AI and the exact split instead of prioritizing a web tab', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('a');
    dock.openLink('https://a.example');
    dock.toggleSplitView();
    const split = dock.getSnapshot().splitTabIds;
    dock.activate(CHAT_TAB_ID);
    dock.setActiveWorkspace(globalId);
    dock.openLink('https://global.example');
    expect(dock.getSnapshot().splitTabIds).toBeUndefined();
    dock.setActiveWorkspace('a');
    expect(dock.getSnapshot()).toMatchObject({ activeTabId: CHAT_TAB_ID, splitTabIds: split });
  });

  it('persists Global web tabs independently across restart without importing Canvas tabs', () => {
    let saved: string | null = null;
    const persistence = createDockSessionPersistence({
      getItem: () => saved,
      setItem: (_key, value) => { saved = value; },
    });
    const dock = new DockStore(persistence);
    dock.setActiveWorkspace('a');
    dock.openLink('https://a.example');
    dock.setActiveWorkspace(globalId);
    dock.openLink('https://global.example');
    dock.collapse();

    const restarted = new DockStore(persistence);
    restarted.setActiveWorkspace(globalId);
    expect(restarted.getSnapshot()).toMatchObject({
      tabs: [{ kind: 'link', url: 'https://global.example' }], expanded: false,
    });
    restarted.setActiveWorkspace('a');
    expect(restarted.getSnapshot()).toMatchObject({
      tabs: [{ kind: 'link', url: 'https://a.example' }], expanded: true,
    });
  });

  it('preserves hidden guest navigation and background opens alongside scoped previews', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace(globalId);
    dock.openLink('https://before.example');
    const linkId = dock.getSnapshot().activeTabId;
    dock.openArtifact('a', 'report');
    const artifactId = dock.getSnapshot().activeTabId;
    dock.setActiveWorkspace('a');
    dock.updateRetainedLinkTab(globalId, linkId, { url: 'https://after.example' });
    dock.openLinkInWorkspace(globalId, 'https://background.example');
    dock.setActiveWorkspace(globalId);
    expect(dock.getSnapshot()).toMatchObject({
      activeTabId: artifactId,
      tabs: [
        { id: linkId, url: 'https://after.example' },
        { id: artifactId, kind: 'artifact' },
        { url: 'https://background.example' },
      ],
    });
  });

  it('does not revive invalid Canvas or closed MCP App previews from an inactive session', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace(globalId);
    dock.openCanvasPreview('a', 'Canvas A');
    dock.openMcpApp('app-instance', 'App');
    dock.setActiveWorkspace('b');
    dock.setMountedWorkspaces(['a']);
    dock.closeMcpApp('app-instance');
    dock.setActiveWorkspace(globalId);
    expect(dock.getSnapshot().tabs).toEqual([]);
  });

  it('does not create a terminal against the Global storage sentinel', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace(globalId);
    dock.openTerminal();
    dock.newTerminal();
    expect(dock.getSnapshot().terminalTabs).toEqual([]);
  });
});
