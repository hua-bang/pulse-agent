import type { WebviewRegistrationIdentity } from './webview-registration';

/** Main → renderer request produced when an embedded surface opens a link. */
export interface LinkOpenRequest {
  url: string;
  /** Chromium background-tab gesture: open without stealing focus. */
  background?: boolean;
  /** Legacy guest id retained to detect an unresolved or inconsistent source. */
  sourceWebContentsId?: number;
  /** Full source identity when the guest completed registry registration. */
  source?: WebviewRegistrationIdentity;
}
