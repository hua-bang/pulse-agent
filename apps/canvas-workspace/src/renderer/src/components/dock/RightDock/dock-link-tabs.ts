/**
 * Pure link-tab (web tab) helpers for the dock store: id allocation, browser
 * -style insertion next to the opener tab, origin comparison for favicon
 * retention, and the closed-tab stack behind "reopen closed tab".
 *
 * `DockStore` owns commits and persistence; everything here is a value
 * transform so the browsing rules can be tested without React or storage.
 */
import { LINK_TAB_ID, linkTabId } from './dock-tab-ids';
import type { DockLinkTab } from './dock-link-sessions';
import type { DockPreviewTab } from './dock-types';

/** How many closed web tabs stay reopenable. Chrome keeps a long list; the
 *  dock is a side panel, so a short, predictable stack is enough. */
export const CLOSED_TAB_STACK_LIMIT = 10;

/**
 * Pane identity for a global link tab. The tab id is now application-unique,
 * so it is also the stable React/webview pane identity across Workspace
 * switches.
 */
export function linkPaneKey(tabId: string): string {
  return tabId;
}

export interface ClosedLinkTab {
  tab: DockLinkTab;
  /** Position it held in the tab strip, so a reopen lands where it was. */
  index: number;
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
 * Bounded most-recently-closed stack for the application-wide browser.
 */
export class ClosedLinkTabStack {
  private entries: ClosedLinkTab[] = [];

  constructor(private readonly limit = CLOSED_TAB_STACK_LIMIT) {}

  push(entry: ClosedLinkTab): void {
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
  }

  /** Pop the newest globally visible entry. */
  pop(): ClosedLinkTab | undefined {
    return this.entries.pop();
  }

  has(): boolean {
    return this.entries.length > 0;
  }
}
