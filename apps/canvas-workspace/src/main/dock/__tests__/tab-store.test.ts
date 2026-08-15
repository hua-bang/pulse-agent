import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => void>();
vi.mock('electron', () => ({
  ipcMain: { on: (channel: string, cb: (...args: unknown[]) => void) => handlers.set(channel, cb) },
}));

import {
  getDockTabs,
  getGlobalDockTabs,
  getPublishedDockWorkspaceId,
  setupDockTabsIpc,
} from '../tab-store';
import type { AgentContextTabRef } from '../../../shared/agent-chat';

describe('dock tab-store', () => {
  it('returns [] for an unknown workspace', () => {
    expect(getDockTabs('nope')).toEqual([]);
  });

  it('stores tabs published over IPC and ignores malformed payloads', () => {
    setupDockTabsIpc();
    const handler = handlers.get('dock:publish-tabs');
    expect(handler).toBeTypeOf('function');

    const tabs: AgentContextTabRef[] = [
      { id: 'link:1', kind: 'link', title: 'Docs', url: 'https://x.dev', workspaceId: 'ws-1' },
    ];
    handler!({ sender: { id: 101 } }, { workspaceId: 'ws-1', tabs });
    expect(getDockTabs('ws-1')).toEqual(tabs);
    expect(getPublishedDockWorkspaceId(101)).toBe('ws-1');
    expect(getPublishedDockWorkspaceId(202)).toBe('');

    // No tabs array → ignored (keeps the prior snapshot).
    handler!({ sender: { id: 101 } }, { workspaceId: 'ws-1' });
    expect(getDockTabs('ws-1')).toEqual(tabs);

    // No workspaceId → ignored (no crash, nothing stored).
    handler!({ sender: { id: 101 } }, { tabs: [] });
    expect(getDockTabs('')).toEqual([]);
    expect(getPublishedDockWorkspaceId(101)).toBe('ws-1');
  });

  it('keeps global Link Tabs in a separate mirror from workspace resources', () => {
    setupDockTabsIpc();
    const handler = handlers.get('dock:publish-tabs');
    expect(handler).toBeTypeOf('function');

    const globalTabs: AgentContextTabRef[] = [
      {
        id: 'link:global',
        kind: 'link',
        scope: 'global',
        title: 'Global docs',
        url: 'https://global.example/',
        dockWorkspaceId: 'ws-2',
      },
      {
        id: 'artifact:ws-2:a1',
        kind: 'artifact',
        title: 'Resource artifact',
        workspaceId: 'ws-2',
        artifactId: 'a1',
      },
    ];
    handler!({ sender: { id: 303 } }, {
      workspaceId: 'ws-2',
      tabs: globalTabs,
      scope: 'global',
    });

    expect(getGlobalDockTabs()).toEqual([globalTabs[0]]);
    expect(getDockTabs('ws-2')).toEqual([]);
    expect(getPublishedDockWorkspaceId(303)).toBe('ws-2');
  });
});
