export interface LinkApi {
  /** Subscribe to URLs intercepted from embedded webviews / iframes. Returns unsubscribe fn. */
  onOpen: (callback: (data: { url: string }) => void) => () => void;
}
