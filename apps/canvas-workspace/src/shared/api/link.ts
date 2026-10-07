import type { LinkOpenRequest } from '../link-open';

export type { LinkOpenRequest } from '../link-open';

export interface LinkApi {
  /** Subscribe to URLs intercepted from embedded webviews / iframes. Returns unsubscribe fn. */
  onOpen: (callback: (data: LinkOpenRequest) => void) => () => void;
}
