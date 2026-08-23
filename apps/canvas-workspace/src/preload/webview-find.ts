/**
 * Browser-like Ctrl/Cmd+F arbitration for dock web pages.
 *
 * The page receives the key first. After its synchronous keydown handlers
 * finish, cancellation or stopped propagation tells us whether the site
 * claimed Find. Only an unclaimed chord asks the host to show Pulse Canvas's
 * find-in-page chrome.
 */
import { ipcRenderer } from 'electron';
import { DOCK_FIND_FALLBACK_CHANNEL } from '../shared/dock-shortcuts';

type NotifyUnhandledFind = () => void;

const isFindChord = (event: KeyboardEvent): boolean => (
  (event.metaKey || event.ctrlKey)
  && !event.altKey
  && !event.shiftKey
  && event.key.toLowerCase() === 'f'
);

export const installWebviewFindFallbackBridge = (
  target: Window = window,
  notifyUnhandledFind: NotifyUnhandledFind = () => {
    ipcRenderer.sendToHost(DOCK_FIND_FALLBACK_CHANNEL);
  },
): (() => void) => {
  const pendingTimers = new Set<number>();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isFindChord(event) || event.repeat) return;
    // Electron's isolated preload world may flush microtasks before the page's
    // main-world listeners continue. A timer crosses that world boundary and
    // runs only after the complete keydown dispatch, including slow document
    // handlers such as Feishu's editor shortcut layer.
    const timer = target.setTimeout(() => {
      pendingTimers.delete(timer);
      if (!event.defaultPrevented && !event.cancelBubble) notifyUnhandledFind();
    }, 0);
    pendingTimers.add(timer);
  };

  target.addEventListener('keydown', onKeyDown, true);
  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    for (const timer of pendingTimers) target.clearTimeout(timer);
    pendingTimers.clear();
  };
};

export const teardownWebviewFindFallbackBridge = installWebviewFindFallbackBridge();
