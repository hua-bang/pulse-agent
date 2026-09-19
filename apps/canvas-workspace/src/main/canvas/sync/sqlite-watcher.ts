import type { PulseStorage, StorageChange } from '@pulse-coder/storage';

export interface SqliteChangeObserver {
  poll(): Promise<void>;
  stop(): void;
}

/** Poll committed changes, rather than SQLite files, so WAL/checkpoints cannot hide CLI writes. */
export async function observeSqliteChanges(
  store: PulseStorage,
  onChange: (change: StorageChange) => void | Promise<void>,
  intervalMs = 250,
): Promise<SqliteChangeObserver> {
  let cursor = await store.changes.latestCursor();
  let polling = false;
  let stopped = false;
  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      for (;;) {
        const page = await store.changes.read({ cursor, limit: 100 });
        for (const change of page.items) {
          if (stopped) return;
          if (change.domain === 'canvas') await onChange(change);
          cursor = change.cursor;
        }
        if (!page.nextCursor) break;
      }
    } finally {
      polling = false;
    }
  };
  const timer = setInterval(() => {
    void poll().catch(error => console.warn('[canvas-storage] change polling failed', error));
  }, intervalMs);
  timer.unref();
  return {
    poll,
    stop() { stopped = true; clearInterval(timer); },
  };
}
