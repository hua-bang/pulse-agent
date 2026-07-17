import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, cb: (...args: unknown[]) => unknown) => handlers.set(channel, cb),
    handle: (channel: string, cb: (...args: unknown[]) => unknown) => handlers.set(channel, cb),
  },
}));

import { flushBrowsingHistory, recordVisit, searchHistory, setupBrowsingHistoryIpc } from '../history-store';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'canvas-history-'));
  // A fresh path per test also invalidates the store's in-memory cache.
  process.env.PULSE_CANVAS_HISTORY_FILE = join(dir, 'browsing-history.json');
});

afterEach(async () => {
  vi.useRealTimers();
  delete process.env.PULSE_CANVAS_HISTORY_FILE;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('browsing history store', () => {
  it('records visits and searches by url + title terms (AND, case-insensitive)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    await recordVisit({ url: 'https://example.com/docs', title: 'Example Docs' });
    vi.setSystemTime(1_001_000);
    await recordVisit({ url: 'https://other.dev/page', title: 'Other Page' });

    expect(await searchHistory('example docs')).toHaveLength(1);
    expect((await searchHistory('EXAMPLE'))[0].url).toBe('https://example.com/docs');
    // Terms are AND-ed: one matching and one non-matching term → no hit.
    expect(await searchHistory('example nomatch')).toHaveLength(0);
    // Empty query returns everything, most recent first.
    const all = await searchHistory('');
    expect(all.map((e) => e.url)).toEqual(['https://other.dev/page', 'https://example.com/docs']);
  });

  it('merges metadata updates into the same visit, counts a later revisit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    await recordVisit({ url: 'https://example.com' });
    // Late title/favicon events for the same navigation (seconds later).
    vi.setSystemTime(1_002_000);
    await recordVisit({ url: 'https://example.com', title: 'Example' });
    await recordVisit({ url: 'https://example.com', faviconUrl: 'https://example.com/icon.png' });

    let [entry] = await searchHistory('example');
    expect(entry.visitCount).toBe(1);
    expect(entry.title).toBe('Example');
    expect(entry.faviconUrl).toBe('https://example.com/icon.png');

    // A real revisit outside the merge window bumps the count.
    vi.setSystemTime(1_002_000 + 31_000);
    await recordVisit({ url: 'https://example.com' });
    [entry] = await searchHistory('example');
    expect(entry.visitCount).toBe(2);
    expect(entry.title).toBe('Example');
  });

  it('ignores non-http(s) and invalid urls', async () => {
    await recordVisit({ url: 'about:blank' });
    await recordVisit({ url: 'file:///etc/passwd' });
    await recordVisit({ url: 'javascript:alert(1)' });
    await recordVisit({ url: 'not a url' });
    expect(await searchHistory('')).toHaveLength(0);
  });

  it('persists across a fresh module load', async () => {
    await recordVisit({ url: 'https://persisted.dev', title: 'Persisted' });
    await flushBrowsingHistory();

    vi.resetModules();
    const fresh = await import('../history-store');
    const [entry] = await fresh.searchHistory('persisted');
    expect(entry.url).toBe('https://persisted.dev');
    expect(entry.title).toBe('Persisted');
  });

  it('serves record + search over IPC', async () => {
    setupBrowsingHistoryIpc();
    const record = handlers.get('history:record');
    const search = handlers.get('history:search');
    expect(record).toBeTypeOf('function');
    expect(search).toBeTypeOf('function');

    record!({}, { url: 'https://ipc.example.com', title: 'Via IPC' });
    // record is fire-and-forget; give its async body a beat.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const results = (await search!({}, { query: 'ipc' })) as Array<{ url: string }>;
    expect(results.map((e) => e.url)).toEqual(['https://ipc.example.com']);
  });
});
