import { useCallback, useEffect, useRef, useState } from 'react';
import type { LanguageCode } from '../../i18n/messages';
import type { EmbeddedWebviewTag } from './types';

export interface UnloadPrompt {
  /** The page vetoed the last reload/back/forward; the surface asks the user. */
  blocked: boolean;
  /** Skip the page's veto once and replay the vetoed action. */
  leave: () => void;
  stay: () => void;
}

// Kept out of the shared message table: that table ships in the startup
// bundle, and only the lazy web card and dock tab show this prompt.
const copy = {
  en: { title: 'Leave this page?', message: 'Changes you made may not be saved.', leave: 'Leave', stay: 'Stay' },
  zh: { title: '离开此页面？', message: '你所做的更改可能不会保存。', leave: '离开', stay: '留在此页' },
};

export const leavePageCopy = (language: LanguageCode) => (language === 'zh' ? copy.zh : copy.en);

const guestId = (webview: EmbeddedWebviewTag | null): number | null => {
  try {
    return webview?.getWebContentsId() ?? null;
  } catch {
    return null; // not attached yet
  }
};

/**
 * Host-chrome side of main's unload prompt (`main/app/browsing/unload-prompt.ts`).
 * Each toolbar action is announced before it runs. When the page's
 * beforeunload handler vetoes it, main cancels it and reports back here, so
 * the surface can ask in app chrome instead of a native dialog.
 */
export const useUnloadPrompt = (webview: EmbeddedWebviewTag | null, onBlocked: () => void) => {
  const [blocked, setBlocked] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;

  const announce = useCallback((action: () => void) => {
    const id = guestId(webview);
    if (id === null) return;
    pendingRef.current = action;
    window.canvasWorkspace?.iframe?.expectUnload?.(id);
  }, [webview]);

  useEffect(() => {
    setBlocked(false);
    pendingRef.current = null;
    const subscribe = window.canvasWorkspace?.iframe?.onUnloadBlocked;
    if (!webview || typeof subscribe !== 'function') return undefined;
    const handleNavigate = () => setBlocked(false);
    webview.addEventListener('did-navigate', handleNavigate);
    const unsubscribe = subscribe(({ webContentsId }) => {
      if (webContentsId !== guestId(webview) || !pendingRef.current) return;
      setBlocked(true);
      onBlockedRef.current();
    });
    return () => {
      webview.removeEventListener('did-navigate', handleNavigate);
      unsubscribe();
    };
  }, [webview]);

  const leave = useCallback(() => {
    setBlocked(false);
    const action = pendingRef.current;
    pendingRef.current = null;
    const id = guestId(webview);
    if (!action || id === null) return;
    window.canvasWorkspace?.iframe?.allowUnload?.(id);
    action();
  }, [webview]);

  const stay = useCallback(() => {
    setBlocked(false);
    pendingRef.current = null;
  }, []);

  return { announce, prompt: { blocked, leave, stay } satisfies UnloadPrompt };
};
