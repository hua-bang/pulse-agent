/**
 * Renderer-side index of mounted web-tab guests: `webContents.id` → dock tab
 * id.
 *
 * Main intercepts `window.open` / target=_blank inside a guest and forwards
 * the URL to the embedder (`main/app/link-policy.ts`), tagging it with the
 * guest's `webContents.id`. Only the renderer knows which dock tab that guest
 * belongs to, so this index is what lets a link opened from tab A land next
 * to tab A instead of at the far end of the strip.
 *
 * Module-level rather than context state on purpose: it is a lookup keyed by
 * a process id, nothing renders from it, and the dock's `link:open`
 * subscription must be able to resolve an opener synchronously.
 */
const tabIdByWebContentsId = new Map<number, string>();

/** Bind a guest id to its dock tab. Returns the unbind for effect cleanup. */
export function registerLinkTabWebview(webContentsId: number, tabId: string): () => void {
  tabIdByWebContentsId.set(webContentsId, tabId);
  return () => {
    if (tabIdByWebContentsId.get(webContentsId) === tabId) {
      tabIdByWebContentsId.delete(webContentsId);
    }
  };
}

export function unregisterLinkTabWebview(webContentsId: number): void {
  tabIdByWebContentsId.delete(webContentsId);
}

/** The dock tab hosting this guest, if it is a web tab we still have mounted. */
export function linkTabIdForWebContents(webContentsId: number | undefined): string | undefined {
  return webContentsId === undefined ? undefined : tabIdByWebContentsId.get(webContentsId);
}
