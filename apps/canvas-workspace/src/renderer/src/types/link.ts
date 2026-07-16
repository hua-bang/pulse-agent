export interface LinkApi {
  /** Subscribe to URLs intercepted from embedded webviews / iframes. Returns unsubscribe fn. */
  onOpen: (callback: (data: { url: string }) => void) => () => void;
  registerTabWebview: (
    tabId: string,
    webContentsId: number,
    metadata?: { title?: string; url?: string },
  ) => Promise<{ ok: boolean }>;
  unregisterTabWebview: (tabId: string) => Promise<{ ok: boolean }>;
}
