import { useSyncExternalStore } from 'react';

/**
 * Scheduled tasks the user deleted while the Undo toast still shows.
 *
 * The real `scheduled.remove` waits until the toast closes, because a task
 * re-created from a snapshot would get a new id and lose its run history and
 * built-in identity. The set lives at module level so the row stays hidden
 * when the Scheduled page remounts during that time.
 */
let pending: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

const publish = (next: ReadonlySet<string>) => {
  pending = next;
  listeners.forEach((listener) => listener());
};

export const markPendingDelete = (taskId: string): void => {
  publish(new Set(pending).add(taskId));
};

export const clearPendingDelete = (taskId: string): void => {
  if (!pending.has(taskId)) return;
  const next = new Set(pending);
  next.delete(taskId);
  publish(next);
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const snapshot = () => pending;

export const usePendingDeletes = (): ReadonlySet<string> => (
  useSyncExternalStore(subscribe, snapshot, snapshot)
);
