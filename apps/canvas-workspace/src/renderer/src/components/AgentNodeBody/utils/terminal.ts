import { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { BASE_TERMINAL_FONT_SIZE } from '../../../config/terminalTheme';
import { count } from '../../../perf/counters';

export const SCROLLBACK_SAVE_INTERVAL = 2000;
export const MAX_SCROLLBACK_CHARS = 50000;

export interface TerminalSnapshot {
  scrollback: string;
  cwd: string;
}

interface TerminalSessionOwnerEntry {
  token: symbol;
  finalizing: boolean;
  lastSnapshot?: TerminalSnapshot;
  finalSnapshot: Promise<TerminalSnapshot | undefined>;
  resolveFinalSnapshot: (snapshot?: TerminalSnapshot) => void;
}

export interface TerminalSessionOwner {
  beginFinalization: () => void;
  finishFinalization: () => void;
  persistIfCurrent: (
    snapshot: TerminalSnapshot,
    persist: (snapshot: TerminalSnapshot) => void | Promise<void>,
  ) => Promise<void>;
}

export interface PtySpawnLifecycle {
  cancel: (cleanup?: () => void) => void;
  isCancelled: () => boolean;
  reclaimIfCancelled: (
    result: { ok: boolean; leaseId?: string },
    kill: (leaseId?: string) => void,
  ) => boolean;
}

export const createPtySpawnLifecycle = (owner?: TerminalSessionOwner): PtySpawnLifecycle => {
  let cancelled = false;
  return {
    cancel: (cleanup) => {
      if (cancelled) return;
      cancelled = true;
      cleanup?.();
      owner?.beginFinalization();
    },
    isCancelled: () => cancelled,
    reclaimIfCancelled: (result, kill) => {
      if (!cancelled) return false;
      try {
        if (result.ok) kill(result.leaseId);
      } finally {
        owner?.finishFinalization();
      }
      return true;
    },
  };
};

const terminalSessionOwners = new Map<string, TerminalSessionOwnerEntry>();

const mergeTerminalSnapshots = (
  previous: TerminalSnapshot | undefined,
  current: TerminalSnapshot,
): TerminalSnapshot => {
  if (!previous) return current;
  if (!current.scrollback) {
    return { scrollback: previous.scrollback, cwd: current.cwd || previous.cwd };
  }
  if (current.scrollback.includes(previous.scrollback)) return current;
  const scrollback = `${previous.scrollback}\n${current.scrollback}`.slice(-MAX_SCROLLBACK_CHARS);
  return { scrollback, cwd: current.cwd || previous.cwd };
};

/**
 * Coordinates renderer mounts that reuse one main-process PTY. A successor
 * suppresses its predecessor's late store write, but awaits and folds that
 * final snapshot into its own next write so output/CWD survive the handoff.
 */
export const claimTerminalSessionOwner = (
  sessionId: string,
): TerminalSessionOwner => {
  const predecessor = terminalSessionOwners.get(sessionId);
  const predecessorFinalSnapshot = predecessor?.finalizing
    ? predecessor.finalSnapshot
    : Promise.resolve(undefined);
  let resolveFinalSnapshot!: (snapshot?: TerminalSnapshot) => void;
  const entry: TerminalSessionOwnerEntry = {
    token: Symbol(sessionId),
    finalizing: false,
    finalSnapshot: new Promise((resolve) => { resolveFinalSnapshot = resolve; }),
    resolveFinalSnapshot,
  };
  terminalSessionOwners.set(sessionId, entry);
  let finished = false;

  return {
    beginFinalization: () => { entry.finalizing = true; },
    finishFinalization: () => {
      if (finished) return;
      finished = true;
      entry.resolveFinalSnapshot(entry.lastSnapshot);
      if (terminalSessionOwners.get(sessionId)?.token === entry.token) {
        terminalSessionOwners.delete(sessionId);
      }
    },
    persistIfCurrent: async (snapshot, persist) => {
      const rebased = mergeTerminalSnapshots(await predecessorFinalSnapshot, snapshot);
      if (terminalSessionOwners.get(sessionId)?.token !== entry.token) {
        entry.lastSnapshot = rebased;
        return;
      }
      try {
        await persist(rebased);
        entry.lastSnapshot = undefined;
      } catch (error) {
        entry.lastSnapshot = rebased;
        throw error;
      }
    },
  };
};

interface TerminalSnapshotPersisterOptions {
  initialSnapshot: TerminalSnapshot;
  readSnapshot: () => TerminalSnapshot | Promise<TerminalSnapshot>;
  persist: (snapshot: TerminalSnapshot) => void | Promise<void>;
}

export interface TerminalSnapshotPersister {
  markDirty: () => void;
  flush: () => Promise<boolean>;
  flushFinal: () => Promise<boolean>;
}

const terminalSnapshotsEqual = (left: TerminalSnapshot, right: TerminalSnapshot): boolean =>
  left.scrollback === right.scrollback && left.cwd === right.cwd;

/**
 * Coalesces PTY output between save ticks and avoids scanning xterm's full
 * scrollback buffer while the session is idle. Snapshot reads happen eagerly
 * when a flush is scheduled so an unmount can dispose xterm without racing a
 * queued persistence operation.
 */
export const createTerminalSnapshotPersister = ({
  initialSnapshot,
  readSnapshot,
  persist,
}: TerminalSnapshotPersisterOptions): TerminalSnapshotPersister => {
  let dirtyVersion = 0;
  let capturedVersion = 0;
  let lastPersisted = initialSnapshot;
  let queue: Promise<void> = Promise.resolve();

  const flush = (): Promise<boolean> => {
    if (dirtyVersion === capturedVersion) return Promise.resolve(false);

    const version = dirtyVersion;
    let captured: Promise<TerminalSnapshot>;
    try {
      captured = Promise.resolve(readSnapshot());
    } catch (error) {
      return Promise.reject(error);
    }
    capturedVersion = version;

    const result = queue.then(async () => {
      const snapshot = await captured;
      if (terminalSnapshotsEqual(snapshot, lastPersisted)) return false;
      await persist(snapshot);
      lastPersisted = snapshot;
      return true;
    });
    queue = result.then(
      () => undefined,
      () => {
        // Keep the failed generation dirty so a later tick can retry it.
        if (capturedVersion === version) capturedVersion = version - 1;
      },
    );
    return result;
  };

  return {
    markDirty: () => {
      dirtyVersion += 1;
    },
    flush,
    flushFinal: flush,
  };
};

/**
 * xterm parses writes asynchronously. Marking a snapshot dirty before the
 * write callback can let a save tick scan the previous buffer and then treat
 * that stale scan as current. Always acknowledge output after the parser has
 * incorporated it.
 */
export const writeTerminalOutput = (
  term: Terminal,
  data: string,
  persister: TerminalSnapshotPersister,
  appendNewline = false,
): void => {
  const parsed = () => persister.markDirty();
  if (appendNewline) term.writeln(data, parsed);
  else term.write(data, parsed);
};

/**
 * Queue an empty write behind all pending xterm parser work, then capture the
 * final buffer before disposing the terminal. readTerminalSnapshot scans the
 * buffer synchronously when flushFinal starts, so disposal can happen as soon
 * as that call has captured its generation; CWD IPC/persistence may finish
 * afterward without touching xterm.
 */
export const finalizeTerminalSnapshotBeforeDispose = (
  term: Terminal,
  persister: TerminalSnapshotPersister,
  dispose: () => void,
): void => {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    persister.markDirty();
    void persister.flushFinal()
      .catch(() => undefined)
      .finally(dispose);
  };
  try {
    term.write('', finish);
  } catch {
    finish();
  }
};

/** localStorage key for recently-used working directories across all agent nodes. */
export const RECENT_CWDS_KEY = 'canvas-workspace:recent-cwds';
export const MAX_RECENT_CWDS = 5;

export const loadRecentCwds = (): string[] => {
  try {
    const raw = localStorage.getItem(RECENT_CWDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export const pushRecentCwd = (cwd: string): string[] => {
  const current = loadRecentCwds().filter((c) => c !== cwd);
  const next = [cwd, ...current].slice(0, MAX_RECENT_CWDS);
  try {
    localStorage.setItem(RECENT_CWDS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
};

export const serializeBuffer = (term: Terminal): string => {
  const buf = term.buffer.active;
  const lines: string[] = [];
  const count = buf.length;
  for (let i = 0; i < count; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  let text = lines.join('\n');
  text = text.replace(/\n+$/, '');
  if (text.length > MAX_SCROLLBACK_CHARS) text = text.slice(-MAX_SCROLLBACK_CHARS);
  return text;
};

export const readTerminalSnapshot = (
  term: Terminal,
  readCwd: () => Promise<{ ok: boolean; cwd?: string | null }>,
  fallbackCwd: string,
): Promise<TerminalSnapshot> => {
  const scrollback = serializeBuffer(term);
  return readCwd().then(
    (result) => ({
      scrollback,
      cwd: result.ok && result.cwd ? result.cwd : fallbackCwd,
    }),
    () => ({ scrollback, cwd: fallbackCwd }),
  );
};

/** Truncate a path for display, keeping the last N segments. */
export const truncatePath = (p: string, maxLen = 36): string => {
  if (p.length <= maxLen) return p;
  const parts = p.replace(/\/$/, '').split('/');
  let result = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = parts[i] + '/' + result;
    if (next.length > maxLen) return '\u2026/' + result;
    result = next;
  }
  return result;
};

/** Read the cascading `--canvas-scale` CSS variable injected by
 *  `CanvasSurface` onto `.canvas-transform`. Falls back to 1 when the
 *  element is detached or the var is missing/invalid. */
export const readCanvasScale = (el: HTMLElement | null | undefined): number => {
  if (!el) return 1;
  const raw = getComputedStyle(el).getPropertyValue('--canvas-scale').trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/** Keep the xterm font size in lock-step with the canvas zoom so the
 *  visual text size scales with the rest of the canvas while the xterm
 *  subtree stays in a net `transform: 1` coordinate space (thanks to the
 *  inverse-scale wrapper in the matching CSS). The combination lets
 *  selection math stay self-consistent and gives users a true zoom on the
 *  glyph size. Returns true when the font size was actually changed so
 *  callers can decide whether to re-fit. */
export const syncTerminalFontSizeToCanvas = (
  term: Terminal | null,
  containerEl: HTMLElement | null | undefined,
): boolean => {
  if (!term) return false;
  const scale = readCanvasScale(containerEl);
  const next = BASE_TERMINAL_FONT_SIZE * scale;
  if (term.options.fontSize === next) return false;
  term.options.fontSize = next;
  return true;
};

/** Convenience wrapper: sync font size to canvas scale, then re-fit. */
export const fitTerminalWithCanvasScale = (
  term: Terminal | null,
  fit: FitAddon | null,
  containerEl: HTMLElement | null | undefined,
): void => {
  count('terminal-fit');
  syncTerminalFontSizeToCanvas(term, containerEl);
  try { fit?.fit(); } catch { /* ignore */ }
};

/** Trailing debounce for ResizeObserver-driven terminal refits (perf
 *  finding E2). A refit re-measures glyphs, reallocates xterm's render
 *  canvases, and can emit a `pty:resize` IPC — running that once per
 *  animation frame for every terminal while the canvas fit animation
 *  transitions `--canvas-scale` (or while the user drag-resizes a node)
 *  froze the renderer. One trailing refit after the burst settles is
 *  visually equivalent: mid-burst the terminal is stretching anyway. */
export const TERMINAL_REFIT_DEBOUNCE_MS = 120;

export const createDebouncedTerminalRefit = (
  refit: () => void,
): { schedule: () => void; cancel: () => void } => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refit();
      }, TERMINAL_REFIT_DEBOUNCE_MS);
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
};
