/**
 * Per-workspace archive of closed web tabs. It replaces the in-memory
 * "recently closed" stack: entries survive a restart, keep why and when the
 * tab closed, and back both "reopen closed tab" and the switcher's archive
 * group. Automatic cleanup and manual closes both land here, so a cleanup
 * never loses a page.
 *
 * `DockStore` pushes and pops entries; the switcher lists, removes and
 * clears them, and subscribes to re-render on those changes.
 */
import { parseLinkTab } from '../state/dock-session-persistence';
import type { DockLinkTab } from './dock-link-sessions';

export const DOCK_TAB_ARCHIVE_STORAGE_KEY = 'pulse-canvas.right-dock-tab-archive';
const ARCHIVE_VERSION = 1;

/** Archived tabs kept per workspace; past it the oldest entries drop. */
export const ARCHIVE_LIMIT_PER_WORKSPACE = 100;

/** Bound on the whole archive, so many canvases cannot grow storage without limit. */
const ARCHIVE_TOTAL_LIMIT = 2000;

/** Why a tab left the strip: the user closed it, it sat unused, or the strip was over its cap. */
export type DockTabArchiveReason = 'manual' | 'idle' | 'overflow';

export interface DockArchivedTab {
  tab: DockLinkTab;
  /** Position it held in the tab strip, so a reopen lands where it was. */
  index: number;
  /** Owning workspace — a tab closed in one canvas must not resurface in another. */
  workspaceId: string;
  /** Epoch ms of the close. */
  closedAt: number;
  reason: DockTabArchiveReason;
}

export interface DockTabArchivePersistence {
  load: () => DockArchivedTab[];
  save: (entries: readonly DockArchivedTab[]) => void;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const REASONS = new Set<unknown>(['manual', 'idle', 'overflow']);

const parseEntry = (value: unknown): DockArchivedTab | null => {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;
  const tab = parseLinkTab(entry.tab);
  if (
    !tab
    || typeof entry.workspaceId !== 'string'
    || !entry.workspaceId
    || !Number.isInteger(entry.index)
    || !Number.isFinite(entry.closedAt)
    || !REASONS.has(entry.reason)
  ) {
    return null;
  }
  return {
    tab,
    index: Math.max(0, entry.index as number),
    workspaceId: entry.workspaceId,
    closedAt: entry.closedAt as number,
    reason: entry.reason as DockTabArchiveReason,
  };
};

export const createDockTabArchivePersistence = (storage: StorageLike): DockTabArchivePersistence => ({
  load: () => {
    try {
      const raw = storage.getItem(DOCK_TAB_ARCHIVE_STORAGE_KEY);
      const value = raw ? JSON.parse(raw) as { version?: unknown; entries?: unknown } : null;
      if (value?.version !== ARCHIVE_VERSION || !Array.isArray(value.entries)) return [];
      return value.entries.slice(-ARCHIVE_TOTAL_LIMIT).flatMap((entry) => {
        const parsed = parseEntry(entry);
        return parsed ? [parsed] : [];
      });
    } catch {
      return [];
    }
  },
  save: (entries) => {
    try {
      storage.setItem(DOCK_TAB_ARCHIVE_STORAGE_KEY, JSON.stringify({ version: ARCHIVE_VERSION, entries }));
    } catch {
      // A full or blocked storage keeps the archive for this launch only.
    }
  },
});

/**
 * Entries are kept oldest first, so `list` and `pop` share one newest-first
 * offset. Every change is saved and reported to `subscribe` listeners.
 */
export class DockTabArchive {
  private entries: DockArchivedTab[];
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  private readonly revealListeners = new Set<() => void>();
  /** Set by `requestReveal` until a switcher takes it; the switcher can mount after the request. */
  private revealPending = false;

  constructor(
    private readonly persistence?: DockTabArchivePersistence,
    private readonly limit = ARCHIVE_LIMIT_PER_WORKSPACE,
  ) {
    this.entries = persistence?.load() ?? [];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Changes on every push, pop, remove or clear; a `useSyncExternalStore` snapshot. */
  getRevision = (): number => this.revision;

  push(entry: DockArchivedTab): void {
    this.entries.push(entry);
    const own = this.entries.filter((item) => item.workspaceId === entry.workspaceId);
    if (own.length > this.limit) {
      const dropped = new Set(own.slice(0, own.length - this.limit));
      this.entries = this.entries.filter((item) => !dropped.has(item));
    }
    if (this.entries.length > ARCHIVE_TOTAL_LIMIT) this.entries = this.entries.slice(-ARCHIVE_TOTAL_LIMIT);
    this.changed();
  }

  /** This workspace's entries, newest first; the index is the offset `pop` and `remove` take. */
  list(workspaceId: string): DockArchivedTab[] {
    return this.entries.filter((entry) => entry.workspaceId === workspaceId).reverse();
  }

  has(workspaceId: string): boolean {
    return this.entries.some((entry) => entry.workspaceId === workspaceId);
  }

  /** Take the entry at `offset` (newest first) out of the archive, for a reopen. */
  pop(workspaceId: string, offset = 0): DockArchivedTab | undefined {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (this.entries[index].workspaceId !== workspaceId) continue;
      if (offset-- > 0) continue;
      const [entry] = this.entries.splice(index, 1);
      this.changed();
      return entry;
    }
    return undefined;
  }

  /** Delete one entry for good. */
  remove(workspaceId: string, offset: number): void {
    this.pop(workspaceId, offset);
  }

  clear(workspaceId: string): void {
    if (!this.has(workspaceId)) return;
    this.entries = this.entries.filter((entry) => entry.workspaceId !== workspaceId);
    this.changed();
  }

  /** Ask the tab switcher to open on the archive (the toast's "view" button). */
  requestReveal(): void {
    this.revealPending = true;
    for (const listener of [...this.revealListeners]) listener();
  }

  subscribeReveal = (listener: () => void): (() => void) => {
    this.revealListeners.add(listener);
    return () => { this.revealListeners.delete(listener); };
  };

  /** True once per `requestReveal`. */
  takeReveal = (): boolean => {
    const pending = this.revealPending;
    this.revealPending = false;
    return pending;
  };

  private changed(): void {
    this.revision += 1;
    this.persistence?.save(this.entries);
    for (const listener of [...this.listeners]) listener();
  }
}
