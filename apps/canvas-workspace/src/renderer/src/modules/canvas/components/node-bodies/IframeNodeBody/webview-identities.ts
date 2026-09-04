import type { WebviewRegistrationIdentity } from '../../../../../../../shared/webview-registration';

const identityByWebContentsId = new Map<number, WebviewRegistrationIdentity>();

/** Bind a mounted guest id to its full renderer-known identity. */
export function registerMountedWebviewIdentity(
  identity: WebviewRegistrationIdentity,
): () => void {
  identityByWebContentsId.set(identity.webContentsId, identity);
  return () => {
    if (identityByWebContentsId.get(identity.webContentsId) === identity) {
      identityByWebContentsId.delete(identity.webContentsId);
    }
  };
}

/** Resolve the current generation of a mounted guest synchronously. */
export function mountedWebviewIdentityForWebContents(
  webContentsId: number | undefined,
): WebviewRegistrationIdentity | undefined {
  return webContentsId === undefined ? undefined : identityByWebContentsId.get(webContentsId);
}
