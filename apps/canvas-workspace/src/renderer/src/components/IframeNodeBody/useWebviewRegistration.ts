import { useEffect } from 'react';
import type { EmbeddedWebviewTag } from '../EmbeddedBrowser/types';

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
}: {
  webview: EmbeddedWebviewTag | null;
  workspaceId: string | undefined;
  nodeId: string;
  enabled: boolean;
}): void => {
  useEffect(() => {
    if (!enabled || !workspaceId || !webview) return;

    const api = window.canvasWorkspace.iframe;
    let registeredId: number | null = null;

    const tryRegister = (ready = false) => {
      if (registeredId !== null && !ready) return;
      try {
        const id = webview.getWebContentsId();
        if (typeof id === 'number') {
          registeredId = id;
          if (ready) void api.registerWebview(workspaceId, nodeId, id, true);
          else void api.registerWebview(workspaceId, nodeId, id);
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
      webview.removeEventListener('did-attach', handleAttach);
      webview.removeEventListener('dom-ready', handleReady);
      if (registeredId !== null) {
        void api.unregisterWebview(workspaceId, nodeId, registeredId);
      }
    };
  }, [webview, workspaceId, nodeId, enabled]);
};
