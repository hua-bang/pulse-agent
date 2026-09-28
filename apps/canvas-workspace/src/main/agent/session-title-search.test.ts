import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readAll: vi.fn() }));
vi.mock('./session-store', () => ({
  SessionStore: { readAllSessionsWithMeta: mocks.readAll },
}));

import { resetSessionTitleSearchForTests, searchSessionTitles } from './session-title-search';

const stored = (sessionId: string, title: string) => ({
  session: {
    sessionId,
    workspaceId: 'ws-1',
    startedAt: '2026-09-12T10:00:00.000Z',
    messages: [{ role: 'user', content: title }],
  },
  workspaceName: 'Product',
  isCurrent: false,
  sortKey: 1,
});

afterEach(() => {
  resetSessionTitleSearchForTests();
  mocks.readAll.mockReset();
});

describe('searchSessionTitles', () => {
  it('matches titles and workspace names from one cached scan across keystrokes', async () => {
    mocks.readAll.mockResolvedValue([stored('s-1', 'CPA Manager plan'), stored('s-2', 'OKR review')]);

    expect(await searchSessionTitles('c')).toHaveLength(2);
    expect(await searchSessionTitles('cp')).toEqual([
      expect.objectContaining({ sessionId: 's-1', workspaceName: 'Product', date: '2026-09-12' }),
    ]);
    expect(await searchSessionTitles('product', 1)).toHaveLength(1);
    expect(mocks.readAll).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight scan and skips it for blank queries', async () => {
    mocks.readAll.mockResolvedValue([stored('s-1', 'OKR review')]);

    expect(await searchSessionTitles('   ')).toEqual([]);
    expect(mocks.readAll).not.toHaveBeenCalled();

    await Promise.all([searchSessionTitles('o'), searchSessionTitles('ok')]);
    expect(mocks.readAll).toHaveBeenCalledTimes(1);
  });
});
