import { useCallback } from 'react';
import { useLocation } from 'wouter';
import { useRightDock } from '../RightDock';
import { resolveScheduledChatTarget } from './scheduledChatTarget';
import { useScheduledRunToasts } from './useScheduledRunToasts';

interface Options {
  /** Current app view, so the opener knows whether a dock chat tab exists. */
  activeView: string;
  /** The AI Chat route, owned by the router host. */
  chatRoute: string;
}

/**
 * Wires the scheduled-run completion toast to the task's conversation.
 *
 * The conversation opens in the dock's Pulse AI tab — the same surface
 * `Run now` uses — so acting on a finished run never navigates the app away
 * from what the user was doing. Only views that hide the dock chat tab fall
 * back to the AI Chat route (see `resolveScheduledChatTarget`).
 */
export const useScheduledRunChatOpener = ({ activeView, chatRoute }: Options): void => {
  const dock = useRightDock();
  const [, setLocation] = useLocation();
  useScheduledRunToasts(useCallback((taskId: string) => {
    const target = resolveScheduledChatTarget({ activeView, taskId, chatRoute });
    if (target.kind === 'dock') {
      dock.openScheduledChat(taskId);
      return;
    }
    setLocation(target.path);
  }, [activeView, chatRoute, dock, setLocation]));
};
