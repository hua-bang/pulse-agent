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
  it('round-trips the application-global link session', () => {
    const storage = createStorage();
    const persistence = createDockSessionPersistence(storage);
    persistence.save({
      __global__: {
        tabs: [{ id: 'link:1', kind: 'link', title: 'Example', url: 'https://example.com' }],
        activeTabId: 'link:1',
        expanded: true,
      },
    });

    expect(JSON.parse(storage.read() ?? '')).toMatchObject({ version: 2 });
    expect(persistence.load()).toEqual({
      __global__: {
        tabs: [{ id: 'link:1', kind: 'link', title: 'Example', url: 'https://example.com' }],
        activeTabId: 'link:1',
        expanded: true,
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

  it('still reads version-1 workspace sessions for the global migration', () => {
    const storage = createStorage(JSON.stringify({
      version: 1,
      sessions: {
        'ws-a': {
          tabs: [{ id: 'link:legacy', kind: 'link', title: 'Legacy', url: 'https://legacy.example' }],
          activeTabId: 'link:legacy',
          expanded: true,
        },
      },
    }));

    expect(createDockSessionPersistence(storage).load()).toEqual({
      'ws-a': {
        tabs: [{ id: 'link:legacy', kind: 'link', title: 'Legacy', url: 'https://legacy.example' }],
        activeTabId: 'link:legacy',
        expanded: true,
      },
    });
  });

  it('treats unreadable storage as an empty session', () => {
    const storage = createStorage('{not json');
    expect(createDockSessionPersistence(storage).load()).toEqual({});
  });
});
