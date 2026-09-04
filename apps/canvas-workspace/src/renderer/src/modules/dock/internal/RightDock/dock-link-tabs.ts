/**
 * Pure link-tab (web tab) helpers for the dock store: id allocation, browser
 * -style insertion next to the opener tab, origin comparison for favicon
 * retention, and the closed-tab stack behind "reopen closed tab".
 *
 * `DockStore` owns commits and persistence; everything here is a value
 * transform so the browsing rules can be tested without React or storage.
 */
import { LINK_TAB_ID, linkTabId } from '../../../../shared/dock/dock-tab-ids';
import type { DockLinkTab } from './dock-link-sessions';
import type { DockPreviewTab, RetainedLinkWorkspace } from './dock-types';

/** How many closed web tabs stay reopenable. Chrome keeps a long list; the
 *  dock is a side panel, so a short, predictable stack is enough. */
export const CLOSED_TAB_STACK_LIMIT = 10;

/**
 * How many RECENTLY-LEFT workspaces keep their web tabs mounted.
 *
 * Each retained tab is a live guest process until the lifecycle ladder
 * throttles and eventually freezes/discards it, so this is the memory knob.
 * Two covers the shapes people actually do — A↔B ping-pong, and A→B→C→A —
 * without holding a long tail of canvases nobody is going back to.
 */
export const RETAINED_WORKSPACE_LIMIT = 2;

/**
 * Pane identity for a link tab. Tab ids are derived from the URL, so the SAME
 * id can exist in two workspaces — anything keyed per mounted pane (React
 * keys, the lazy-mount set) must qualify it with the owning workspace.
 */
export function linkPaneKey(workspaceId: string, tabId: string): string {
  return `${workspaceId}::${tabId}`;
}

/**
 * Roll the retention list on a workspace switch: the workspace being left
 * goes to the front, the one being entered leaves the list (its tabs become
 * live again), and the tail past the limit is dropped — those guests unmount
 * and their pages will reload if the user ever goes back.
 */
export function updateRetainedLinkTabs(
  current: readonly RetainedLinkWorkspace[],
  leaving: RetainedLinkWorkspace,
  enteringWorkspaceId: string,
  limit = RETAINED_WORKSPACE_LIMIT,
): RetainedLinkWorkspace[] {
  const kept = current.filter(
    (entry) => entry.workspaceId !== enteringWorkspaceId && entry.workspaceId !== leaving.workspaceId,
  );
  const shouldRetain = Boolean(leaving.workspaceId)
    && leaving.workspaceId !== enteringWorkspaceId
    && leaving.tabs.length > 0;
  const next = shouldRetain ? [leaving, ...kept] : kept;
  return next.slice(0, Math.max(0, limit));
}

/**
 * Apply a live update from a hidden tab's guest (it navigated, resolved a
 * title, or reported an icon while in the background).
 *
 * This is not bookkeeping for its own sake: the stored URL is what the tab
 * is restored to on the way back, and `useEmbeddedBrowser` treats a stored
 * URL that differs from the live guest as a navigation COMMAND. Letting the
 * two drift would yank a background-navigated page back to where it was when
 * the user left — the exact state loss retention exists to prevent.
 */
export function applyRetainedTabPatch(
  current: readonly RetainedLinkWorkspace[],
  workspaceId: string,
  tabId: string,
  patch: Partial<Pick<DockLinkTab, 'url' | 'title' | 'faviconUrl'>>,
): RetainedLinkWorkspace[] | null {
  const entryIndex = current.findIndex((entry) => entry.workspaceId === workspaceId);
  if (entryIndex === -1) return null;
  const entry = current[entryIndex];
  const tabIndex = entry.tabs.findIndex((tab) => tab.id === tabId);
  if (tabIndex === -1) return null;
  const tab = entry.tabs[tabIndex];
  const next = { ...tab, ...patch };
  if (next.url === tab.url && next.title === tab.title && next.faviconUrl === tab.faviconUrl) {
    return null;
  }
  const tabs = [...entry.tabs];
  tabs[tabIndex] = next;
  const entries = [...current];
  entries[entryIndex] = { ...entry, tabs };
  return entries;
}

export interface ClosedLinkTab {
  tab: DockLinkTab;
  /** Position it held in the tab strip, so a reopen lands where it was. */
  index: number;
  /** Owning workspace — a tab closed in one canvas must not resurface in another. */
  workspaceId: string;
}

/**
 * Same-origin test used to decide whether a navigation may keep the tab's
 * resolved favicon. Non-parseable input is never treated as same-origin.
 */
export function isSameOrigin(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** First unused id derived from `baseId` (`base`, `base:2`, `base:3`, …). */
export function allocateTabId(tabs: readonly { id: string }[], baseId: string): string {
  if (!tabs.some((tab) => tab.id === baseId)) return baseId;
  let suffix = 2;
  let id = `${baseId}:${suffix}`;
  while (tabs.some((tab) => tab.id === id)) {
    suffix += 1;
    id = `${baseId}:${suffix}`;
  }
  return id;
}

/** Id for a fresh blank tab; `ordinal` only seeds the base, collisions still resolve. */
export function blankLinkTabId(tabs: readonly { id: string }[], ordinal: number): string {
  return allocateTabId(tabs, `${LINK_TAB_ID}:new:${ordinal}`);
}

/** Id for a tab opened at a specific URL. */
export function urlLinkTabId(tabs: readonly { id: string }[], url: string): string {
  return allocateTabId(tabs, linkTabId(url));
}

/**
 * Browser-style placement: a tab opened FROM another tab lands directly after
 * that opener and after any siblings it already spawned, so a burst of links
 * from one page stays grouped in click order instead of scattering at the far
 * end of the strip. Without a live opener the tab is appended.
 */
export function insertLinkTab(
  tabs: readonly DockPreviewTab[],
  tab: DockPreviewTab,
  openerTabId?: string,
): DockPreviewTab[] {
  const openerIndex = openerTabId ? tabs.findIndex((item) => item.id === openerTabId) : -1;
  if (openerIndex === -1) return [...tabs, tab];
  let insertAt = openerIndex + 1;
  while (
    insertAt < tabs.length
    && tabs[insertAt].kind === 'link'
    && (tabs[insertAt] as DockLinkTab).openerTabId === openerTabId
  ) {
    insertAt += 1;
  }
  return [...tabs.slice(0, insertAt), tab, ...tabs.slice(insertAt)];
}

/**
 * Bounded most-recently-closed stack. Entries are workspace-scoped because
 * link tabs are per-workspace sessions: reopening in a different canvas would
 * drop a tab into a strip it never belonged to.
 */
export class ClosedLinkTabStack {
  private entries: ClosedLinkTab[] = [];

  constructor(private readonly limit = CLOSED_TAB_STACK_LIMIT) {}

  push(entry: ClosedLinkTab): void {
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
  }

  /** Pop the newest entry for `workspaceId`, leaving other workspaces' alone. */
  pop(workspaceId: string): ClosedLinkTab | undefined {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (this.entries[index].workspaceId !== workspaceId) continue;
      const [entry] = this.entries.splice(index, 1);
      return entry;
    }
    return undefined;
  }

  has(workspaceId: string): boolean {
    return this.entries.some((entry) => entry.workspaceId === workspaceId);
  }
}
