import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ scan: vi.fn(), names: vi.fn() }));
vi.mock('./session-store-scan', () => ({ scanAllWorkspaceSessions: mocks.scan }));
vi.mock('./session-store-lookups', () => ({
  GLOBAL_CHAT_SESSION_STORE_ID: '__global_chat__',
  GLOBAL_CHAT_WORKSPACE_NAME: 'No workspace',
  workspaceNames: mocks.names,
}));
vi.mock('../sqlite-session-backend', () => ({ sessionStorageRoot: () => '/sessions' }));

import { searchSessionTitles } from './session-title-search';

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
    expect(await searchSessionTitles('no workspace')).toEqual([
      expect.objectContaining({ sessionId: 's-global', workspaceName: 'No workspace' }),
    ]);
    expect(await searchSessionTitles('product', 1)).toHaveLength(1);
    expect(mocks.scan).toHaveBeenCalledWith('/sessions');
  });

  it('skips the scan for blank queries', async () => {
    expect(await searchSessionTitles('   ')).toEqual([]);
    expect(mocks.scan).not.toHaveBeenCalled();
  });
});
