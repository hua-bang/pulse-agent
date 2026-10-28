import { describe, expect, it, vi } from 'vitest';
import { DOCK_TAB_LIMIT, IDLE_TAB_MS, overflowTabIds, staleTabIds } from '../tabs/dock-tab-cleanup';
import { DockStore, type DockLinkSessions, type DockPreviewTab } from '../state/dock-store';
import { dedupeUrlKey } from '../links/dock-link-commands';

const link = (id: string, extra: Partial<DockPreviewTab> = {}): DockPreviewTab => (
  { id, kind: 'link', title: id, url: `https://${id}.example`, ...extra } as DockPreviewTab
);

describe('dock tab cleanup rules', () => {
  it('closes the least recently used tabs past the cap, left to right on ties', () => {
    const tabs = ['a', 'b', 'c', 'd'].map((id) => link(id));
    const state = { tabs, activeTabId: 'd' };
    expect(overflowTabIds({ a: 5, b: 1, c: 1, d: 0 }, state, 2)).toEqual(['b', 'c']);
  });

  it('never closes the active, split, pinned, folder or MCP App tab', () => {
    const tabs: DockPreviewTab[] = [
      link('active'), link('split'), link('pinned', { pinned: true }),
      { id: 'folder', kind: 'folder', title: 'Repo', folderPath: '/repo' },
      { id: 'mcp-app:x', kind: 'mcp-app', title: 'App', instanceId: 'x' },
      link('old'),
    ];
    const state = { tabs, activeTabId: 'active', splitTabIds: ['split', 'chat'] as [string, string] };
    expect(staleTabIds({}, state, 10 * IDLE_TAB_MS)).toEqual([]);
    expect(overflowTabIds({}, state, 1)).toEqual(['old']);
    const times = Object.fromEntries(tabs.map((tab) => [tab.id, 0]));
    expect(staleTabIds(times, state, IDLE_TAB_MS)).toEqual(['old']);
  });

  it('counts idle closes toward the cap before closing more', () => {
    const tabs = ['a', 'b', 'c', 'd'].map((id) => link(id));
    const now = 10 * IDLE_TAB_MS;
    const state = { tabs, activeTabId: 'd' };
    expect(staleTabIds({ a: 0, b: now - 2, c: now - 1, d: now }, state, now)).toEqual(['a']);
  });

  it('treats an anchor or trailing slash as the same page, but not a hash route or query', () => {
    expect(dedupeUrlKey('https://a.example/doc/#intro')).toBe(dedupeUrlKey('https://a.example/doc'));
    expect(dedupeUrlKey('https://a.example/#/coupons/1')).not.toBe(dedupeUrlKey('https://a.example/#/coupons/2'));
    expect(dedupeUrlKey('https://a.example/?id=1')).not.toBe(dedupeUrlKey('https://a.example/?id=2'));
    expect(dedupeUrlKey('not a url')).toBe('not a url');
  });
});

describe('DockStore tab cleanup', () => {
  it(`keeps at most ${DOCK_TAB_LIMIT} tabs open and the closed ones reopenable`, () => {
    vi.useFakeTimers();
    try {
      const dock = new DockStore();
      dock.setActiveWorkspace('ws-a');
      for (let index = 0; index <= DOCK_TAB_LIMIT; index += 1) {
        vi.setSystemTime(index * 1000);
        dock.openLink(`https://page-${index}.example`);
      }
      const titles = dock.getSnapshot().tabs.map((tab) => tab.title);
      expect(titles).toHaveLength(DOCK_TAB_LIMIT);
      expect(titles).not.toContain('https://page-0.example');
      expect(dock.getClosedTabs().map((tab) => tab.title)).toEqual(['https://page-0.example']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes idle tabs on the first visit after launch, and spares a pinned tab', () => {
    let sessions: DockLinkSessions = {};
    const persistence = { load: () => sessions, save: (next: DockLinkSessions) => { sessions = structuredClone(next); } };
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const dock = new DockStore(persistence);
      dock.setActiveWorkspace('ws-a');
      dock.openLink('https://idle.example');
      dock.openLink('https://pinned.example');
      dock.togglePin(dock.getSnapshot().activeTabId);
      dock.openLink('https://current.example');
      vi.setSystemTime(IDLE_TAB_MS);
      const relaunched = new DockStore(persistence);
      relaunched.setActiveWorkspace('ws-a');
      expect(relaunched.getSnapshot().tabs.map((tab) => tab.title)).toEqual(['https://pinned.example', 'https://current.example']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans a workspace on its first visit after launch, not on later switches', () => {
    let sessions: DockLinkSessions = {};
    const persistence = { load: () => sessions, save: (next: DockLinkSessions) => { sessions = structuredClone(next); } };
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const dock = new DockStore(persistence);
      dock.setActiveWorkspace('ws-a');
      for (const page of ['a', 'b', 'c']) dock.openLink(`https://${page}.example`);
      dock.setActiveWorkspace('ws-b');
      vi.setSystemTime(IDLE_TAB_MS + 1);
      dock.setActiveWorkspace('ws-a');
      expect(dock.getSnapshot().tabs).toHaveLength(3);

      const relaunched = new DockStore(persistence);
      relaunched.setActiveWorkspace('ws-a');
      expect(relaunched.getSnapshot().tabs.map((tab) => tab.title)).toEqual(['https://c.example']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opening a tab enforces only the cap, not the idle rule', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const dock = new DockStore();
      dock.setActiveWorkspace('ws-a');
      dock.openLink('https://old.example');
      vi.setSystemTime(IDLE_TAB_MS + 1);
      dock.openLink('https://new.example');
      expect(dock.getSnapshot().tabs).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves the pin with the web tab', () => {
    let sessions: DockLinkSessions = {};
    const persistence = { load: () => sessions, save: (next: DockLinkSessions) => { sessions = structuredClone(next); } };
    const dock = new DockStore(persistence);
    dock.setActiveWorkspace('ws-a');
    dock.openLink('https://a.example');
    dock.togglePin(dock.getSnapshot().activeTabId);
    expect(sessions['ws-a']?.tabs[0]?.pinned).toBe(true);
  });

  it('reuses the open tab for the same page with an anchor', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('ws-a');
    dock.openLink('https://a.example/doc');
    dock.openLink('https://a.example/doc#section');
    expect(dock.getSnapshot().tabs.map((tab) => tab.kind === 'link' && tab.url)).toEqual(['https://a.example/doc#section']);
  });

  it('keeps a pin when a skill tab is refreshed or a node preview is replaced', () => {
    const dock = new DockStore();
    dock.setActiveWorkspace('ws-a');
    const skill = { name: 'review' } as Parameters<DockStore['openSkill']>[1];
    dock.openSkill({ level: 'global' } as Parameters<DockStore['openSkill']>[0], skill);
    dock.togglePin(dock.getSnapshot().activeTabId);
    dock.openSkill({ level: 'global' } as Parameters<DockStore['openSkill']>[0], skill);
    expect(dock.getSnapshot().tabs[0]?.pinned).toBe(true);

    dock.openNodeDetail('ws-a', 'node-1', 'One', true);
    dock.togglePin(dock.getSnapshot().activeTabId);
    dock.openNodeDetail('ws-a', 'node-2', 'Two', true);
    expect(dock.getSnapshot().tabs.map((tab) => tab.title)).toEqual(['review', 'One', 'Two']);
  });
});
