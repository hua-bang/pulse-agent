import type { WebviewRegistrationIdentity } from '../../shared/webview-registration';

type Source = Pick<WebviewRegistrationIdentity, 'workspaceId' | 'nodeId' | 'webContentsId'>;
const listeners = new Set<{ source: Source; receive: (url: string) => void }>();

/** Main-process observation only; does not change popup/navigation policy. */
export function observePageLinkRequests(source: Source, receive: (url: string) => void): () => void {
  const listener = { source, receive };
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function reportPageLinkRequest(source: Source, url: string): void {
  for (const listener of listeners) {
    if (listener.source.webContentsId !== source.webContentsId
      || listener.source.workspaceId !== source.workspaceId || listener.source.nodeId !== source.nodeId) continue;
    try { listener.receive(url); } catch { /* Diagnostics must not interrupt normal navigation. */ }
  }
}
