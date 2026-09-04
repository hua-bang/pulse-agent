/**
 * Pure `DockState` patches for the web-tab commands, in the same shape as
 * `dock-terminal-tabs.ts`: each function returns the patch to commit, or null
 * for a no-op. `DockStore` keeps only the commit + persistence wiring.
 */
import {
  blankLinkTabId,
  insertLinkTab,
  isSameOrigin,
  urlLinkTabId,
} from './dock-link-tabs';
import type { DockLinkTab } from './dock-link-sessions';
import type { DockPreviewTab, DockState } from './dock-types';

export interface DockOpenLinkOptions {
  /** Open without stealing focus (⌘/Ctrl+click, middle-click). */
  background?: boolean;
  /** Tab the link was opened from, for placement next to its opener. */
  openerTabId?: string;
}

/**
 * Open a URL as a web tab. `background` keeps the user where they are —
 * ⌘/Ctrl+click and middle-click are explicit "queue this for later" gestures,
 * and foregrounding them steals the page being read. `openerTabId` places the
 * new tab next to the tab it came from.
 */
export function getOpenLinkPatch(
  state: DockState,
  url: string,
  { background = false, openerTabId }: DockOpenLinkOptions = {},
): Partial<DockState> | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const existing = state.tabs.find(
    (tab): tab is DockLinkTab => tab.kind === 'link' && tab.url === trimmed,
  );
  // Same page: keep the loaded webview (and its resolved title).
  if (existing) {
    return { expanded: true, ...(background ? {} : { activeTabId: existing.id }) };
  }
  const id = urlLinkTabId(state.tabs, trimmed);
  const tab: DockPreviewTab = {
    id,
    kind: 'link',
    title: trimmed,
    url: trimmed,
    ...(openerTabId ? { openerTabId } : {}),
  };
  return {
    tabs: insertLinkTab(state.tabs, tab, openerTabId),
    ...(background ? {} : { activeTabId: id }),
    expanded: true,
  };
}

/** Blank tab. Unlike an opened URL, blank tabs are never deduped. */
export function getNewLinkPatch(
  state: DockState,
  title: string,
  ordinal: number,
): Partial<DockState> {
  const id = blankLinkTabId(state.tabs, ordinal);
  const tab: DockPreviewTab = { id, kind: 'link', title, url: '' };
  return { tabs: [...state.tabs, tab], activeTabId: id, expanded: true };
}

/** Address-bar navigation: a new destination, so the title and icon reset. */
export function getNavigateLinkPatch(
  state: DockState,
  id: string,
  url: string,
): Partial<DockState> | null {
  const trimmed = url.trim();
  const tab = state.tabs.find((item) => item.id === id);
  if (!trimmed || tab?.kind !== 'link') return null;
  return {
    tabs: state.tabs.map((item) => (
      item.id === id ? { ...item, url: trimmed, title: trimmed, faviconUrl: undefined } : item
    )),
  };
}

/**
 * Mirror a guest URL without overwriting its resolved page title. The favicon
 * survives same-origin navigation: SPA route changes fire this on every
 * pushState but re-announce `page-favicon-updated` only when the icon link
 * actually changes, so clearing unconditionally left those tabs stuck on the
 * generic globe until a full reload.
 */
export function getSyncLinkUrlPatch(
  state: DockState,
  id: string,
  url: string,
): Partial<DockState> | null {
  const trimmed = url.trim();
  const tab = state.tabs.find((item) => item.id === id);
  if (!trimmed || tab?.kind !== 'link' || tab.url === trimmed) return null;
  const keepFavicon = isSameOrigin(tab.url, trimmed);
  return {
    tabs: state.tabs.map((item) => (item.id === id
      ? { ...item, url: trimmed, ...(keepFavicon ? {} : { faviconUrl: undefined }) }
      : item)),
  };
}

/** Live label update (artifact loaded, webview resolved a page title). */
export function getSetTitlePatch(
  state: DockState,
  id: string,
  title: string,
): Partial<DockState> | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const tab = state.tabs.find((item) => item.id === id);
  if (!tab || tab.title === trimmed) return null;
  return { tabs: state.tabs.map((item) => (item.id === id ? { ...item, title: trimmed } : item)) };
}

/** Live favicon update, so the tab tracks the site instead of a globe. */
export function getSetFaviconPatch(
  state: DockState,
  id: string,
  faviconUrl: string,
): Partial<DockState> | null {
  const trimmed = faviconUrl.trim();
  if (!trimmed) return null;
  const tab = state.tabs.find((item) => item.id === id);
  if (!tab || tab.kind !== 'link' || tab.faviconUrl === trimmed) return null;
  return {
    tabs: state.tabs.map((item) => (item.id === id && item.kind === 'link'
      ? { ...item, faviconUrl: trimmed }
      : item)),
  };
}
