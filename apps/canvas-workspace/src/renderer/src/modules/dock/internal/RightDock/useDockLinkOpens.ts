import { useEffect } from 'react';
import type { LinkOpenRequest } from '../../../../../../shared/link-open';
import { mountedWebviewIdentityForWebContents } from '../../../canvas/webview';
import { focusActiveDockTarget } from './dock-browser-commands';
import type { DockStore } from './dock-store';

const isCurrentMountedIdentity = (request: LinkOpenRequest): boolean => {
  if (!request.source) return request.sourceWebContentsId === undefined;
  if (
    request.sourceWebContentsId !== undefined
    && request.sourceWebContentsId !== request.source.webContentsId
  ) return false;
  const mounted = mountedWebviewIdentityForWebContents(request.source.webContentsId);
  return Boolean(
    mounted
    && mounted.workspaceId === request.source.workspaceId
    && mounted.nodeId === request.source.nodeId
    && mounted.webContentsId === request.source.webContentsId
    && mounted.surfaceKind === request.source.surfaceKind,
  );
};

/** Route a main-process link event without guessing its owning workspace. */
export function routeDockLinkOpen(store: DockStore, request: LinkOpenRequest): boolean {
  if (!isCurrentMountedIdentity(request)) return false;
  const workspaceBefore = store.getSnapshot().activeTerminalWorkspaceId;
  if (request.source) {
    store.openLinkInWorkspace(request.source.workspaceId, request.url, {
      background: request.background,
      ...(request.source.surfaceKind === 'dock-browser'
        ? { openerTabId: request.source.nodeId }
        : {}),
    });
  } else {
    store.openLink(request.url, { background: request.background });
  }
  if (
    !request.background
    && (!request.source || request.source.workspaceId === workspaceBefore)
  ) focusActiveDockTarget(store);
  return true;
}

export function useDockLinkOpens(store: DockStore): void {
  useEffect(() => window.canvasWorkspace.link.onOpen(
    (request) => { routeDockLinkOpen(store, request); },
  ), [store]);
}
