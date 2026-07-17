import { describe, expect, it } from 'vitest';
import { createDockSessionPersistence, DOCK_SESSION_STORAGE_KEY } from '../dock-session-persistence';

const createStorage = (initial?: string) => {
  let value = initial ?? null;
  return {
    getItem: (key: string) => key === DOCK_SESSION_STORAGE_KEY ? value : null,
    setItem: (key: string, next: string) => {
      if (key === DOCK_SESSION_STORAGE_KEY) value = next;
    },
    read: () => value,
  };
};

describe('dock session persistence', () => {
  it('round-trips workspace-scoped link tabs', () => {
    const storage = createStorage();
    const persistence = createDockSessionPersistence(storage);
    persistence.save({
      'ws-a': {
        tabs: [{ id: 'link:1', kind: 'link', title: 'Example', url: 'https://example.com' }],
        activeTabId: 'link:1',
      },
    });

    expect(JSON.parse(storage.read() ?? '')).toMatchObject({ version: 1 });
    expect(persistence.load()).toEqual({
      'ws-a': {
        tabs: [{ id: 'link:1', kind: 'link', title: 'Example', url: 'https://example.com' }],
        activeTabId: 'link:1',
      },
    });
  });

  it('drops malformed tabs and stale active ids instead of failing startup', () => {
    const storage = createStorage(JSON.stringify({
      version: 1,
      sessions: {
        'ws-a': {
          tabs: [
            { id: 'link:ok', kind: 'link', title: 'Safe', url: 'https://example.com' },
            { id: 4, kind: 'link', title: 'Bad', url: 'https://bad.example' },
            { id: 'artifact:1', kind: 'artifact', title: 'Not a web tab', url: '' },
          ],
          activeTabId: 'missing',
        },
      },
    }));

    expect(createDockSessionPersistence(storage).load()).toEqual({
      'ws-a': {
        tabs: [{ id: 'link:ok', kind: 'link', title: 'Safe', url: 'https://example.com' }],
        activeTabId: undefined,
      },
    });
  });

  it('treats unreadable storage as an empty session', () => {
    const storage = createStorage('{not json');
    expect(createDockSessionPersistence(storage).load()).toEqual({});
  });
});
