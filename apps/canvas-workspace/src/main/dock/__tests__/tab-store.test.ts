import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => void>();
vi.mock('electron', () => ({
  ipcMain: { on: (channel: string, cb: (...args: unknown[]) => void) => handlers.set(channel, cb) },
}));

import { getDockTabs, setupDockTabsIpc } from '../tab-store';
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
    handler!({}, { workspaceId: 'ws-1', tabs });
    expect(getDockTabs('ws-1')).toEqual(tabs);

    // No tabs array → ignored (keeps the prior snapshot).
    handler!({}, { workspaceId: 'ws-1' });
    expect(getDockTabs('ws-1')).toEqual(tabs);

    // No workspaceId → ignored (no crash, nothing stored).
    handler!({}, { tabs: [] });
    expect(getDockTabs('')).toEqual([]);
  });
});
