import { flushWorkspacePersistence } from '../../../shared/workspacePersistence';

/**
 * Final save on quit. Main closes storage before windows close, so it asks
 * each window to save first (see main/canvas/flush-before-quit.ts). Nodes
 * that hold unsaved state register a task that writes it and flushes their
 * workspace; main is answered once every task settles. The entry installs
 * the listener at startup, so a window with no tasks answers at once instead
 * of making main wait out its timeout.
 */
type BeforeQuitTask = () => Promise<void> | void;

const tasks = new Set<BeforeQuitTask>();
let installed = false;

/** True only when every task finished. A rejection is an unsaved quit. */
export const runBeforeQuitTasks = async (): Promise<boolean> => {
  const results = await Promise.allSettled([...tasks].map(task => Promise.resolve().then(task)));
  return results.every(result => result.status === 'fulfilled');
};

export const installBeforeQuitFlush = (): void => {
  const store = window.canvasWorkspace?.store;
  if (installed || !store?.onFlushBeforeQuit) return;
  installed = true;
  store.onFlushBeforeQuit((requestId) => {
    void runBeforeQuitTasks()
      .then(ok => store.flushedBeforeQuit(requestId, ok))
      .catch(() => store.flushedBeforeQuit(requestId, false));
  });
};

/** Run `task` before the app quits; returns an unregister function. */
export const registerBeforeQuit = (task: BeforeQuitTask): (() => void) => {
  installBeforeQuitFlush();
  tasks.add(task);
  return () => { tasks.delete(task); };
};

/**
 * Save a workspace now. A failure rejects so the quit handshake can refuse
 * to treat the quit as saved. Callers that only need a best-effort write
 * catch it themselves.
 */
export const flushWorkspace = async (workspaceId: string | undefined): Promise<void> => {
  if (workspaceId) await flushWorkspacePersistence(workspaceId);
};
