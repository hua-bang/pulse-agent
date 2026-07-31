import type { LinkOpenRequest } from '../../../shared/link-open';

export type { LinkOpenRequest } from '../../../shared/link-open';

export interface LinkApi {
  /** Subscribe to URLs intercepted from embedded webviews / iframes. Returns unsubscribe fn. */
  onOpen: (callback: (data: LinkOpenRequest) => void) => () => void;
}
