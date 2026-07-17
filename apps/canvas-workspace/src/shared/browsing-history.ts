/**
 * Browsing history for right-dock web (link) tabs.
 *
 * Contract between main (`src/main/dock/history-store.ts`), preload
 * (`src/preload/bridge/history.ts`), and the renderer (LinkTabView records
 * visits; the Canvas Agent searches them via `canvas_search_history`).
 * JSON-safe and runtime-neutral — no Electron/Node imports.
 */

export interface BrowsingHistoryEntry {
  url: string;
  title: string;
  faviconUrl?: string;
  /** Distinct visits (metadata updates within a visit don't inflate this). */
  visitCount: number;
  /** Epoch ms. */
  firstVisitedAt: number;
  /** Epoch ms. */
  lastVisitedAt: number;
}

export interface BrowsingHistoryRecordInput {
  url: string;
  title?: string;
  faviconUrl?: string;
}

export interface BrowsingHistoryApi {
  /** Record a visit (fire-and-forget). Upserted by exact URL in main. */
  record: (input: BrowsingHistoryRecordInput) => void;
  /**
   * Search history, most recent first. Terms are matched case-insensitively
   * against URL + title (all terms must match). Empty query returns the most
   * recent entries.
   */
  search: (query: string, limit?: number) => Promise<BrowsingHistoryEntry[]>;
}
