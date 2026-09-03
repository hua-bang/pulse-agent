import { useEffect } from 'react';
import type { EmbeddedWebviewTag } from '../../../../platform/browser/types';
import {
  consumeDockPageFocusRequest,
  dockPageKeyFromFocusEvent,
  FOCUS_DOCK_PAGE_EVENT,
  requestDockPageFocus,
} from '../RightDock/dock-browser-commands';

interface UseDockPageFocusOptions {
  active: boolean;
  workspaceId: string;
  tabId?: string;
  webview: EmbeddedWebviewTag | null;
}

export function focusDockPageOrRequest({
  workspaceId,
  tabId,
  webview,
}: Omit<UseDockPageFocusOptions, 'active'>): void {
  if (webview && (!('isConnected' in webview) || webview.isConnected)) {
    try {
      webview.focus();
      return;
    } catch {
      // Preserve the intent for the replacement guest below.
    }
  }
  if (tabId) requestDockPageFocus({ workspaceId, tabId });
}

/**
 * Move keyboard focus into the exact workspace-qualified browser guest that
 * owns a user navigation gesture. A pending request can arrive before a cold
 * guest mounts, so the newly mounted owner gets one chance to claim it.
 */
export function useDockPageFocus({
  active,
  workspaceId,
  tabId,
  webview,
}: UseDockPageFocusOptions): void {
  useEffect(() => {
    if (!tabId) return;
    const target = { workspaceId, tabId };
    let focusFrame: number | null = null;
    const claimAndFocus = () => {
      if (!active || !webview || focusFrame !== null) return;
      focusFrame = requestAnimationFrame(() => {
        focusFrame = null;
        if (!active || ('isConnected' in webview && !webview.isConnected)) return;
        if (!consumeDockPageFocusRequest(target)) return;
        try {
          webview.focus();
        } catch {
          // A guest can disappear between the connection check and focus.
          // Re-announce so its exact replacement can claim the same intent.
          requestDockPageFocus(target);
        }
      });
    };
    const onFocusPage = (event: Event) => {
      const requested = dockPageKeyFromFocusEvent(event);
      if (
        requested?.workspaceId !== target.workspaceId
        || requested.tabId !== target.tabId
      ) return;
      claimAndFocus();
    };
    window.addEventListener(FOCUS_DOCK_PAGE_EVENT, onFocusPage);
    claimAndFocus();
    return () => {
      window.removeEventListener(FOCUS_DOCK_PAGE_EVENT, onFocusPage);
      if (focusFrame !== null) cancelAnimationFrame(focusFrame);
    };
  }, [active, tabId, webview, workspaceId]);
}
