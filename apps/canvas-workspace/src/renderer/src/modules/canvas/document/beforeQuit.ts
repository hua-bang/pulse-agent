import { flushAllWorkspacePersistence } from '../../../shared/workspacePersistence';

/**
 * Final save on quit. Main closes storage before windows close, so it asks
 * each window to save first (see main/canvas/flush-before-quit.ts). Node
 * bodies write their last state on BEFORE_QUIT_EVENT, synchronously; every
 * mounted workspace then flushes, and main is answered once they settle.
 */
export const BEFORE_QUIT_EVENT = 'pulse-canvas:before-quit';

export const runBeforeQuitFlush = async (): Promise<void> => {
  window.dispatchEvent(new Event(BEFORE_QUIT_EVENT));
  await flushAllWorkspacePersistence();
};

let installed = false;

/** Answer main's quit handshake for this window (idempotent). */
export const installBeforeQuitFlush = (): void => {
  const store = window.canvasWorkspace?.store;
  if (installed || !store?.onFlushBeforeQuit) return;
  installed = true;
  store.onFlushBeforeQuit((requestId) => {
    void runBeforeQuitFlush().finally(() => store.flushedBeforeQuit(requestId));
  });
};
