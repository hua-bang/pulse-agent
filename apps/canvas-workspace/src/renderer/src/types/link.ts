export interface LinkOpenRequest {
  url: string;
  /**
   * True for gestures that explicitly mean "not now" — ⌘/Ctrl+click and
   * middle-click, which Chromium reports as `background-tab`. The dock opens
   * these without stealing focus from the page being read.
   */
  background?: boolean;
  /**
   * `webContents.id` of the guest the link came from, so the dock can place
   * the new tab next to the tab that opened it. Absent for links intercepted
   * outside a webview (canvas iframes, the host window).
   */
  sourceWebContentsId?: number;
}

export interface LinkApi {
  /** Subscribe to URLs intercepted from embedded webviews / iframes. Returns unsubscribe fn. */
  onOpen: (callback: (data: LinkOpenRequest) => void) => () => void;
}
