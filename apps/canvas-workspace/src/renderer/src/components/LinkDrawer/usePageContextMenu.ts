/**
 * Subscription + placement for a web tab's right-click menu.
 *
 * Main relays every guest `context-menu` to this window; a tab claims only
 * the ones raised by its own guest. Coordinates arrive in the GUEST's
 * viewport space, so they are offset by the host element's rect to become
 * host viewport coordinates the popover can use.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { WebviewContextMenuRequest } from '../../../../shared/webview-context-menu';
import { useGuestInteractionShield } from '../../hooks/useGuestInteractionShield';

export interface PageContextMenuState {
  request: WebviewContextMenuRequest;
  x: number;
  y: number;
}

interface Options {
  /** This tab's guest, once Electron has attached it. */
  guestId: number | null;
  /** Element the guest fills — the origin of the guest's coordinate space. */
  hostRef: RefObject<HTMLElement>;
}

export const usePageContextMenu = ({ guestId: webContentsId, hostRef }: Options) => {
  const [menu, setMenu] = useState<PageContextMenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);

  // While the menu is open, clicks must be able to dismiss it — including
  // clicks that land on the page itself, which otherwise never reach this
  // document at all.
  useGuestInteractionShield(menu !== null);

  useEffect(() => {
    if (webContentsId === null) return;
    const onContextMenu = window.canvasWorkspace?.iframe?.onContextMenu;
    if (typeof onContextMenu !== 'function') return;
    return onContextMenu((request) => {
      if (request.sourceWebContentsId !== webContentsId) return;
      const rect = hostRef.current?.getBoundingClientRect();
      setMenu({
        request,
        x: (rect?.left ?? 0) + request.x,
        y: (rect?.top ?? 0) + request.y,
      });
    });
  }, [webContentsId, hostRef]);

  // A guest that navigates or goes away must not leave a menu describing a
  // page that is no longer there.
  useEffect(() => {
    if (webContentsId === null) setMenu(null);
  }, [webContentsId]);

  return { menu, close };
};
