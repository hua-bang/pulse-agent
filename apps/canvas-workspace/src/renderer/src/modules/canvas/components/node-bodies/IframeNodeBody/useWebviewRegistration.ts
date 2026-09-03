import { useEffect, useRef } from 'react';
import {
  DEFAULT_WEBVIEW_SURFACE_KIND,
  type WebviewSurfaceKind,
} from '../../../../../../../shared/webview-registration';
import type { EmbeddedWebviewTag } from '../../../../../components/dock/EmbeddedBrowser/types';
import { registerMountedWebviewIdentity } from './webview-identities';

/**
 * Registers the mounted `<webview>`'s webContentsId with main's webview
 * registry (main/webview/registry.ts) so the Canvas Agent can read the
 * rendered DOM and the lifecycle ladder can throttle/freeze/discard the
 * guest. The id is not available until Electron attaches the guest, so
 * registration retries on `did-attach` and re-announces with `ready` on
 * `dom-ready` (used for perf marks).
 *
 * Teardown passes the SAME webContentsId back: main's unregister is a
 * compare-and-delete, so this effect's cleanup racing a remount (wake from
 * discard, url-mode flip) can never evict the newer generation's
 * registration — and a guest that dies without cleanup is auto-unregistered
 * by main's `destroyed` hook.
 */
export const useWebviewRegistration = ({
  webview,
  workspaceId,
  nodeId,
  enabled,
  surfaceKind = DEFAULT_WEBVIEW_SURFACE_KIND,
  onWebContentsId,
}: {
  webview: EmbeddedWebviewTag | null;
  workspaceId: string | undefined;
  nodeId: string;
  enabled: boolean;
  surfaceKind?: WebviewSurfaceKind;
  /** Also observe the resolved guest id renderer-side (null on teardown).
   *  Reuses this hook's attach handshake instead of a second listener pair. */
  onWebContentsId?: (webContentsId: number | null) => void;
}): void => {
  const onWebContentsIdRef = useRef(onWebContentsId);
  onWebContentsIdRef.current = onWebContentsId;

  useEffect(() => {
    if (!enabled || !workspaceId || !webview) return;

    const api = window.canvasWorkspace.iframe;
    let registeredId: number | null = null;
    let reportedId: number | null = null;
    let unregisterMountedIdentity: (() => void) | null = null;
    let disposed = false;

    const tryRegister = (ready = false) => {
      if (registeredId !== null && !ready) return;
      try {
        const id = webview.getWebContentsId();
        if (typeof id === 'number') {
          const isNew = registeredId !== id;
          registeredId = id;
          const registration = ready
            ? api.registerWebview(workspaceId, nodeId, id, surfaceKind, true)
            : api.registerWebview(workspaceId, nodeId, id, surfaceKind);
          if (!isNew && reportedId === id) return;
          void registration.then((result) => {
            if (!result.ok || disposed || registeredId !== id || reportedId === id) return;
            unregisterMountedIdentity?.();
            unregisterMountedIdentity = registerMountedWebviewIdentity({
              workspaceId,
              nodeId,
              webContentsId: id,
              surfaceKind,
            });
            reportedId = id;
            onWebContentsIdRef.current?.(id);
          }).catch(() => undefined);
        }
      } catch {
        // WebContents id is not available until Electron attaches the guest.
      }
    };

    tryRegister();
    const handleAttach = () => tryRegister(false);
    const handleReady = () => tryRegister(true);
    webview.addEventListener('did-attach', handleAttach);
    webview.addEventListener('dom-ready', handleReady);

    return () => {
      disposed = true;
      webview.removeEventListener('did-attach', handleAttach);
      webview.removeEventListener('dom-ready', handleReady);
      unregisterMountedIdentity?.();
      if (registeredId !== null) {
        void api.unregisterWebview(workspaceId, nodeId, registeredId);
      }
      if (reportedId !== null) onWebContentsIdRef.current?.(null);
    };
  }, [webview, workspaceId, nodeId, enabled, surfaceKind]);
};
