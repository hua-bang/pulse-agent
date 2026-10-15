import { useCallback, useEffect } from 'react';
import { useLocation } from 'wouter';
import type { ScheduledRunFinished } from '../../../../../shared/scheduled';
import type { AgentScope } from '../../../types';
import { useRightDock } from '../../../shared/dockPort';
import { resolveScheduledChatTarget } from './scheduledChatTarget';
import { useScheduledRunToasts } from './useScheduledRunToasts';

interface Options {
  /** Current app view, so the opener knows whether a dock chat tab exists. */
  activeView: string;
  /** The AI Chat route, owned by the router host. */
  chatRoute: string;
  /** Opens one durable conversation in the full-page Pulse AI surface. */
  onOpenSessionInScope: (
    scope: AgentScope,
    sessionId: string,
    scopeLabel: string,
  ) => void | Promise<void>;
}

/**
 * Wires the scheduled-run completion toast to the exact conversation that
 * produced it. Where the dock has a chat tab, the run opens there beside the
 * current page; on full-page chat routes it opens in full-page Pulse AI by
 * session id. A failure before session setup has no run id and opens the
 * task's current conversation (see `resolveScheduledChatTarget`).
 */
export const useScheduledRunChatOpener = ({
  activeView,
  chatRoute,
  onOpenSessionInScope,
}: Options): void => {
  const dock = useRightDock();
  const [, setLocation] = useLocation();
  useEffect(() => window.canvasWorkspace.scheduled.onRunFinished((run) => {
    // Refresh is a no-op unless this task is already visible in the Dock. It
    // keeps Run now live without pulling a background task into view.
    dock.refreshScheduledChat(run.taskId);
  }), [dock]);
  useScheduledRunToasts(useCallback((run: ScheduledRunFinished) => {
    const target = resolveScheduledChatTarget({
      activeView,
      taskId: run.taskId,
      chatRoute,
    });
    // The dock shows the exact run beside the current page. A failed session
    // setup has no run id, so the dock falls back to the task's current one.
    if (target.kind === 'dock') {
      dock.openScheduledChat(run.taskId, run.sessionId);
      return;
    }
    if (run.sessionId) {
      void onOpenSessionInScope(
        { kind: 'scheduled', taskId: run.taskId },
        run.sessionId,
        run.title,
      );
      return;
    }
    setLocation(target.path);
  }, [activeView, chatRoute, dock, onOpenSessionInScope, setLocation]));
};
