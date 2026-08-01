import { useCallback, useEffect, useRef } from 'react';
import type { ScheduledRunFinished } from '../../../../shared/scheduled';
import { navigateCanvasRoute } from '../../utils/canvasLinks';
import { useRightDock, useRightDockState } from '../RightDock';
import { isScheduledChatVisible } from '../RightDock/dock-chat-state';
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
 * back to the AI Chat route (see `resolveScheduledChatTarget`), and that
 * fallback carries the task id as a query, so it must go through
 * `navigateCanvasRoute` rather than wouter's `setLocation`, which drops it.
 */
export const useScheduledRunChatOpener = ({ activeView, chatRoute }: Options): void => {
  const dock = useRightDock();
  const dockState = useRightDockState();

  /**
   * A background run's output has to reach a panel that is already open.
   * `ScheduledChatPanel`'s running banner tells the user "the result will
   * appear here", but the only thing that ever refetched the thread was the
   * manual `Run now` path — so an unattended run ended with the banner simply
   * vanishing and not one new message. `refreshScheduledChat` no-ops unless
   * the dock is pointed at that task, and it now bumps `sessionRefreshKey`
   * rather than the panel's `key`, so this reloads history in place instead
   * of remounting a composer the user may be typing into.
   */
  const dockRef = useRef(dock);
  dockRef.current = dock;
  useEffect(() => window.canvasWorkspace.scheduled.onRunFinished(
    (run) => dockRef.current.refreshScheduledChat(run.taskId),
  ), []);

  useScheduledRunToasts(
    useCallback((taskId: string) => {
      const target = resolveScheduledChatTarget({ activeView, taskId, chatRoute });
      if (target.kind === 'dock') {
        dock.openScheduledChat(taskId);
        return;
      }
      navigateCanvasRoute(target.path);
    }, [activeView, chatRoute, dock]),
    useCallback(
      (run: ScheduledRunFinished) => isScheduledChatVisible(dockState, run.taskId),
      [dockState],
    ),
  );
};
