import type {
  CanvasAgentDebugRunDetail,
  CanvasAgentDebugRunSummary,
} from '../../main/agent/types';
import type { PluginStore } from '../types';

export interface StoredRun {
  summary: CanvasAgentDebugRunSummary;
  detail: CanvasAgentDebugRunDetail;
}

interface IndexEntry {
  summary: CanvasAgentDebugRunSummary;
  bytes: number;
}

interface RunIndex {
  version: 1;
  runs: IndexEntry[];
}

export interface RunStoreLimits {
  maxRuns: number;
  maxBytes: number;
}

// Debug traces can hold payload previews of up to ~180k characters each, so
// a count cap alone does not bound disk use.
const DEFAULT_LIMITS: RunStoreLimits = { maxRuns: 200, maxBytes: 50 * 1024 * 1024 };
const INDEX_KEY = 'index';

const runKey = (runId: string) => `runs/${runId}`;
const sizeOf = (run: StoredRun) => Buffer.byteLength(JSON.stringify(run), 'utf8');
const newestFirst = (left: IndexEntry, right: IndexEntry) => right.summary.startedAt - left.summary.startedAt;

/**
 * DevTools run files plus one index of their summaries. Listing reads only
 * the index, and every write prunes the oldest runs past the count or size
 * limit. The newest run is always kept. Callers serialize access.
 */
export function createRunStore(store: PluginStore, limits: RunStoreLimits = DEFAULT_LIMITS) {
  let index: RunIndex | undefined;

  const prune = async (current: RunIndex): Promise<void> => {
    current.runs.sort(newestFirst);
    let totalBytes = 0;
    const kept: IndexEntry[] = [];
    const dropped: IndexEntry[] = [];
    for (const entry of current.runs) {
      const fits = kept.length < limits.maxRuns && totalBytes + entry.bytes <= limits.maxBytes;
      if (kept.length === 0 || fits) {
        kept.push(entry);
        totalBytes += entry.bytes;
      } else {
        dropped.push(entry);
      }
    }
    for (const entry of dropped) await store.delete(runKey(entry.summary.runId));
    current.runs = kept;
    await store.set(INDEX_KEY, current);
  };

  const load = async (): Promise<RunIndex> => {
    if (index) return index;
    // A quit during a write can leave the index truncated; treat it as missing.
    const saved = await store.get<RunIndex>(INDEX_KEY).catch(() => undefined);
    if (saved?.version === 1 && Array.isArray(saved.runs)) {
      index = saved;
      return index;
    }
    // No index yet (first start after an upgrade) or a damaged one: rebuild
    // it from the run files once, which also prunes an unbounded backlog.
    const rebuilt: RunIndex = { version: 1, runs: [] };
    for (const key of await store.list('runs/')) {
      const run = await store.get<StoredRun>(key);
      if (run?.summary) rebuilt.runs.push({ summary: run.summary, bytes: sizeOf(run) });
    }
    await prune(rebuilt);
    index = rebuilt;
    return index;
  };

  return {
    get: (runId: string) => store.get<StoredRun>(runKey(runId)),

    async put(run: StoredRun): Promise<void> {
      const current = await load();
      await store.set(runKey(run.summary.runId), run);
      current.runs = current.runs.filter(entry => entry.summary.runId !== run.summary.runId);
      current.runs.push({ summary: run.summary, bytes: sizeOf(run) });
      await prune(current);
    },

    async list(): Promise<CanvasAgentDebugRunSummary[]> {
      return (await load()).runs.map(entry => entry.summary);
    },
  };
}
