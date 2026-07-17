/**
 * Browsing history for right-dock web (link) tabs.
 *
 * The renderer records visits as its tab webviews navigate (LinkTabView →
 * `history:record`); the Canvas Agent searches them through the
 * `canvas_search_history` tool, and the renderer can query over
 * `history:search` (address-bar suggestions later).
 *
 * IPC channels (registered in `setupBrowsingHistoryIpc`):
 *  - `history:record`  (ipcMain.on)     — upsert a visit {url, title?, faviconUrl?}
 *  - `history:search`  (ipcMain.handle) — {query?, limit?} → BrowsingHistoryEntry[]
 *
 * Persistence: `~/.pulse-coder/canvas/browsing-history.json` (override with
 * `PULSE_CANVAS_HISTORY_FILE` — tests point it into a temp dir). Entries are
 * upserted by exact URL, capped at MAX_ENTRIES by recency, and written back
 * debounced via a temp-file rename so a crash never truncates the file.
 */
import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type {
  BrowsingHistoryEntry,
  BrowsingHistoryRecordInput,
} from '../../shared/browsing-history';

const MAX_ENTRIES = 2000;
const WRITE_DELAY_MS = 400;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 200;
/**
 * Metadata (title/favicon) arrives as separate record calls moments after the
 * navigation itself; records inside this window merge into the same visit so
 * one page load doesn't count as 2-3 visits.
 */
const SAME_VISIT_WINDOW_MS = 30_000;

function historyFilePath(): string {
  const envPath = process.env.PULSE_CANVAS_HISTORY_FILE?.trim();
  return envPath || join(homedir(), '.pulse-coder', 'canvas', 'browsing-history.json');
}

/** Only real web pages are worth remembering (no about:, file:, devtools:). */
function isRecordableUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

let entriesByUrl: Map<string, BrowsingHistoryEntry> | null = null;
/** Path the in-memory state was loaded from — a changed env path (tests) invalidates it. */
let loadedFrom: string | null = null;
let writeTimer: NodeJS.Timeout | null = null;
/** Serializes persist() calls so concurrent flushes can't interleave rename order. */
let lastWrite: Promise<void> = Promise.resolve();

async function loadStore(): Promise<Map<string, BrowsingHistoryEntry>> {
  const path = historyFilePath();
  if (entriesByUrl && loadedFrom === path) return entriesByUrl;
  const loaded = new Map<string, BrowsingHistoryEntry>();
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as { entries?: unknown };
    if (Array.isArray(parsed?.entries)) {
      for (const item of parsed.entries as BrowsingHistoryEntry[]) {
        if (
          item
          && typeof item.url === 'string'
          && isRecordableUrl(item.url)
          && typeof item.lastVisitedAt === 'number'
        ) {
          loaded.set(item.url, {
            url: item.url,
            title: typeof item.title === 'string' ? item.title : '',
            ...(typeof item.faviconUrl === 'string' && item.faviconUrl
              ? { faviconUrl: item.faviconUrl }
              : {}),
            visitCount: typeof item.visitCount === 'number' && item.visitCount > 0 ? item.visitCount : 1,
            firstVisitedAt: typeof item.firstVisitedAt === 'number' ? item.firstVisitedAt : item.lastVisitedAt,
            lastVisitedAt: item.lastVisitedAt,
          });
        }
      }
    }
  } catch {
    // Missing or corrupt file → start empty; the next persist rewrites it.
  }
  entriesByUrl = loaded;
  loadedFrom = path;
  return loaded;
}

function sortedEntries(store: Map<string, BrowsingHistoryEntry>): BrowsingHistoryEntry[] {
  return [...store.values()].sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
}

async function persist(): Promise<void> {
  const store = entriesByUrl;
  if (!store) return;
  const path = historyFilePath();
  const payload = JSON.stringify({ version: 1, entries: sortedEntries(store) });
  lastWrite = lastWrite.then(async () => {
    try {
      await fs.mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await fs.writeFile(tmp, payload, 'utf8');
      await fs.rename(tmp, path);
    } catch (err) {
      console.warn(`[browsing-history] persist failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return lastWrite;
}

function schedulePersist(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void persist();
  }, WRITE_DELAY_MS);
}

/** Await any pending debounced write (tests + app shutdown). */
export async function flushBrowsingHistory(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
    await persist();
    return;
  }
  await lastWrite;
}

export async function recordVisit(input: BrowsingHistoryRecordInput): Promise<void> {
  const url = typeof input?.url === 'string' ? input.url.trim() : '';
  if (!url || !isRecordableUrl(url)) return;
  const store = await loadStore();
  const now = Date.now();
  const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : '';
  const faviconUrl = typeof input.faviconUrl === 'string' ? input.faviconUrl.trim() : '';

  const existing = store.get(url);
  if (existing) {
    const sameVisit = now - existing.lastVisitedAt < SAME_VISIT_WINDOW_MS;
    store.set(url, {
      ...existing,
      ...(title ? { title } : {}),
      ...(faviconUrl ? { faviconUrl } : {}),
      visitCount: sameVisit ? existing.visitCount : existing.visitCount + 1,
      lastVisitedAt: now,
    });
  } else {
    store.set(url, {
      url,
      title,
      ...(faviconUrl ? { faviconUrl } : {}),
      visitCount: 1,
      firstVisitedAt: now,
      lastVisitedAt: now,
    });
    if (store.size > MAX_ENTRIES) {
      // Evict the least recently visited entries down to the cap.
      for (const entry of sortedEntries(store).slice(MAX_ENTRIES)) {
        store.delete(entry.url);
      }
    }
  }
  schedulePersist();
}

export async function searchHistory(query: string, limit?: number): Promise<BrowsingHistoryEntry[]> {
  const store = await loadStore();
  const terms = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const capped = Math.max(1, Math.min(limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT));
  const all = sortedEntries(store);
  const matched = terms.length === 0
    ? all
    : all.filter((entry) => {
        const haystack = `${entry.url}\n${entry.title}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
  return matched.slice(0, capped);
}

export function setupBrowsingHistoryIpc(): void {
  ipcMain.on('history:record', (_event, payload: BrowsingHistoryRecordInput) => {
    void recordVisit(payload);
  });

  ipcMain.handle(
    'history:search',
    (_event, payload: { query?: string; limit?: number }) =>
      searchHistory(payload?.query ?? '', payload?.limit),
  );
}
