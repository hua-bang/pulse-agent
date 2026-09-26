import { flushWorkspacePersistence } from '../../../shared/workspacePersistence';

/**
 * Final save on quit. Main closes storage before windows close, so it asks
 * each window to save first (see main/canvas/flush-before-quit.ts). Nodes
 * that hold unsaved state register a task that writes it and flushes their
 * workspace; main is answered once every task settles. Lives outside the
 * entry chunk: terminal nodes install it when they mount.
 */
type BeforeQuitTask = () => Promise<void> | void;

const tasks = new Set<BeforeQuitTask>();
let installed = false;

export const runBeforeQuitTasks = async (): Promise<void> => {
  await Promise.allSettled([...tasks].map(task => Promise.resolve().then(task)));
};

const installBeforeQuitFlush = (): void => {
  const store = window.canvasWorkspace?.store;
  if (installed || !store?.onFlushBeforeQuit) return;
  installed = true;
  store.onFlushBeforeQuit((requestId) => {
    void runBeforeQuitTasks().finally(() => store.flushedBeforeQuit(requestId));
  });
};

/** Run `task` before the app quits; returns an unregister function. */
export const registerBeforeQuit = (task: BeforeQuitTask): (() => void) => {
  installBeforeQuitFlush();
  tasks.add(task);
  return () => { tasks.delete(task); };
};

/** Save a workspace now; its document reports its own failures. */
export const flushWorkspace = async (workspaceId: string | undefined): Promise<void> => {
  if (workspaceId) await flushWorkspacePersistence(workspaceId).catch(() => undefined);
};
