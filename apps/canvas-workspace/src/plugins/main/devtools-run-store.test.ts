import { describe, expect, it } from 'vitest';

import { createRunStore, type StoredRun } from './devtools-run-store';
import type { PluginStore } from '../types';

const memoryStore = () => {
  const records = new Map<string, string>();
  const reads: string[] = [];
  const store: PluginStore = {
    async get<T>(key: string) {
      reads.push(key);
      const value = records.get(key);
      return value === undefined ? undefined : JSON.parse(value) as T;
    },
    async set(key, value) { records.set(key, JSON.stringify(value)); },
    async delete(key) { records.delete(key); },
    async list(prefix) { return [...records.keys()].filter(key => !prefix || key.startsWith(prefix)); },
  };
  return { store, records, reads };
};

const run = (runId: string, startedAt: number, payload = ''): StoredRun => {
  const summary = { runId, startedAt, payload } as never;
  return { summary, detail: { ...(summary as object), trace: {} } as never };
};

describe('DevTools run store', () => {
  it('keeps only the newest runs past the count limit and lists them from the index', async () => {
    const { store, records, reads } = memoryStore();
    const runs = createRunStore(store, { maxRuns: 2, maxBytes: Infinity });
    await runs.put(run('a', 1));
    await runs.put(run('b', 2));
    await runs.put(run('c', 3));

    expect([...records.keys()].filter(key => key.startsWith('runs/')).sort()).toEqual(['runs/b', 'runs/c']);
    reads.length = 0;
    expect((await runs.list()).map(item => item.runId)).toEqual(['c', 'b']);
    // Listing reads no run files.
    expect(reads).toEqual([]);
  });

  it('drops the oldest runs past the size limit but always keeps the newest', async () => {
    const { store, records } = memoryStore();
    // Each fixture run holds its payload twice (summary and detail): ~2.1 kB.
    const runs = createRunStore(store, { maxRuns: 10, maxBytes: 5_000 });
    await runs.put(run('old', 1, 'x'.repeat(1_000)));
    await runs.put(run('new', 2, 'x'.repeat(1_000)));
    expect(records.has('runs/old')).toBe(true);

    await runs.put(run('huge', 3, 'x'.repeat(5_000)));

    expect([...records.keys()].filter(key => key.startsWith('runs/'))).toEqual(['runs/huge']);
  });

  it('replaces an updated run instead of listing it twice', async () => {
    const { store } = memoryStore();
    const runs = createRunStore(store);
    await runs.put(run('a', 1));
    await runs.put(run('a', 1, 'updated'));

    expect(await runs.list()).toHaveLength(1);
    expect((await runs.get('a'))?.summary).toMatchObject({ payload: 'updated' });
  });

  it('rebuilds a missing index from existing run files and prunes the backlog', async () => {
    const { store, records } = memoryStore();
    for (let index = 0; index < 5; index++) await store.set(`runs/r${index}`, run(`r${index}`, index));

    const runs = createRunStore(store, { maxRuns: 3, maxBytes: Infinity });

    expect((await runs.list()).map(item => item.runId)).toEqual(['r4', 'r3', 'r2']);
    expect(records.has('runs/r0')).toBe(false);
    expect(records.has('index')).toBe(true);
  });
});
