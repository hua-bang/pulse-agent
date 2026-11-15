import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ scan: vi.fn(), names: vi.fn(), readAll: vi.fn() }));
vi.mock('./store/session-store-scan', () => ({ scanAllWorkspaceSessions: mocks.scan }));
vi.mock('./store/session-store-lookups', () => ({
  GLOBAL_CHAT_SESSION_STORE_ID: '__global_chat__',
  GLOBAL_CHAT_WORKSPACE_NAME: 'All workspaces',
  workspaceNames: mocks.names,
  readAllSessionsWithMeta: mocks.readAll,
}));
vi.mock('./sqlite/backend', () => ({ sessionStorageRoot: () => '/sessions' }));

import { searchSessionContent, searchSessionTitles } from './session-title-search';

const listed = (sessionId: string, preview: string, extra: Record<string, unknown> = {}) => ({
  sessionId,
  date: '2026-09-12',
  updatedAt: 1,
  messageCount: 4,
  preview,
  pinned: false,
  isCurrent: false,
  ...extra,
});

afterEach(() => {
  mocks.scan.mockReset();
  mocks.names.mockReset();
  mocks.readAll.mockReset();
});

describe('searchSessionTitles', () => {
  it('matches list metadata (preview, title, workspace) without loading message bodies', async () => {
    mocks.names.mockResolvedValue(new Map([['ws-1', 'Product']]));
    mocks.scan.mockResolvedValue([
      {
        workspaceId: 'ws-1',
        sessions: [
          listed('s-old', 'CPA  Manager plan', { updatedAt: 1 }),
          listed('s-new', 'Unrelated', { updatedAt: 5, title: 'CPA follow-up' }),
        ],
      },
      { workspaceId: '__global_chat__', sessions: [listed('s-global', 'OKR review')] },
    ]);

    expect(await searchSessionTitles('cpa')).toEqual([
      expect.objectContaining({ sessionId: 's-new', workspaceId: 'ws-1', workspaceName: 'Product' }),
      expect.objectContaining({ sessionId: 's-old', preview: 'CPA Manager plan', date: '2026-09-12' }),
    ]);
    expect(await searchSessionTitles('all workspaces')).toEqual([
      expect.objectContaining({ sessionId: 's-global', workspaceName: 'All workspaces' }),
    ]);
    expect(await searchSessionTitles('product', 1)).toHaveLength(1);
    expect(mocks.scan).toHaveBeenCalledWith('/sessions');
  });

  it('skips the scan for blank queries', async () => {
    expect(await searchSessionTitles('   ')).toEqual([]);
    expect(mocks.scan).not.toHaveBeenCalled();
  });
});

const stored = (sessionId: string, sortKey: number, messages: Array<{ role: string; content: string }>) => ({
  session: { sessionId, workspaceId: 'ws-1', startedAt: '2026-09-12T08:00:00Z', messages },
  workspaceName: 'Product',
  isCurrent: false,
  sortKey,
});

describe('searchSessionContent', () => {
  it('matches user and assistant message text, newest first', async () => {
    mocks.readAll.mockResolvedValue([
      stored('s-old', 1, [{ role: 'user', content: 'Plan the launch' }, { role: 'assistant', content: 'Use Kubernetes' }]),
      stored('s-new', 5, [{ role: 'user', content: 'kubernetes ingress?' }]),
      stored('s-tool', 9, [{ role: 'tool', content: 'kubernetes' }]),
      stored('s-miss', 7, [{ role: 'user', content: 'Unrelated' }]),
    ]);

    expect(await searchSessionContent('KUBERNETES')).toEqual([
      expect.objectContaining({ sessionId: 's-new', workspaceName: 'Product', date: '2026-09-12' }),
      expect.objectContaining({ sessionId: 's-old', preview: 'Plan the launch', messageCount: 2 }),
    ]);
    expect(mocks.readAll).toHaveBeenCalledWith('/sessions');
  });

  it('skips the read for blank queries', async () => {
    expect(await searchSessionContent('  ')).toEqual([]);
    expect(mocks.readAll).not.toHaveBeenCalled();
  });
});
