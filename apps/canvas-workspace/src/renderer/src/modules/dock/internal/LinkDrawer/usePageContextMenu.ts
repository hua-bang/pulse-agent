/**
 * Subscription + placement for a web tab's right-click menu.
 *
 * Main relays every guest `context-menu` to this window; a tab claims only
 * the ones raised by its own guest. Electron exposes `params.x/y` after its
 * guest-to-embedder conversion, in the host viewport consumed by the fixed
 * popover. Adding the webview rect again would double-offset the menu.
 */
import { useCallback, useEffect, useState } from 'react';
import type { WebviewContextMenuRequest } from '../../../../../../shared/webview-context-menu';
import { useGuestInteractionShield } from '../../../../hooks/useGuestInteractionShield';

export interface PageContextMenuState {
  request: WebviewContextMenuRequest;
  x: number;
  y: number;
}

interface Options {
  /** This tab's guest, once Electron has attached it. */
  guestId: number | null;
  /** Hidden/retained pages must neither render nor claim a global menu event. */
  active?: boolean;
}

export const usePageContextMenu = ({
  guestId: webContentsId,
  active = true,
}: Options) => {
  const [menu, setMenu] = useState<PageContextMenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);

  // While the menu is open, clicks must be able to dismiss it — including
  // clicks that land on the page itself, which otherwise never reach this
  // document at all.
  useGuestInteractionShield(menu !== null);

  useEffect(() => {
    if (!active || webContentsId === null) return;
    const onContextMenu = window.canvasWorkspace?.iframe?.onContextMenu;
    if (typeof onContextMenu !== 'function') return;
    return onContextMenu((request) => {
      if (request.sourceWebContentsId !== webContentsId) return;
      setMenu({
        request,
        x: request.x,
        y: request.y,
      });
    });
  }, [active, webContentsId]);

  // A guest that navigates or goes away must not leave a menu describing a
  // page that is no longer there.
  useEffect(() => {
    if (!active || webContentsId === null) setMenu(null);
  }, [active, webContentsId]);

  return { menu, close };
};
