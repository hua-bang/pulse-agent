export {
  mountedWebviewIdentityForWebContents,
  registerMountedWebviewIdentity,
} from './components/node-bodies/IframeNodeBody/webview-identities';
export { useWebviewRegistration } from './components/node-bodies/IframeNodeBody/useWebviewRegistration';
export {
  useWebviewRestore,
  type WebviewRestoreTarget,
} from './components/node-bodies/IframeNodeBody/useWebviewDiscard';
export { BLANK_PAGE_URL, normalizeUrl, pickFaviconUrl } from './components/node-bodies/IframeNodeBody/utils';
