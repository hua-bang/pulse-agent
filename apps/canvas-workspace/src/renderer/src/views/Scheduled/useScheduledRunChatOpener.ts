import { useCallback, useEffect } from 'react';
import { useLocation } from 'wouter';
import type { ScheduledRunFinished } from '../../../../shared/scheduled';
import type { AgentScope } from '../../types';
import { useRightDock } from '../../components/dock/RightDock';
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
 * produced it. Durable runs open in full-page Pulse AI, whose ChatTarget
 * contract can select a session by id and return to the previous surface.
 * Task-scope Dock/route navigation survives only for failures that happened
 * before session setup (see `resolveScheduledChatTarget`).
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
    if (run.sessionId) {
      void onOpenSessionInScope(
        { kind: 'scheduled', taskId: run.taskId },
        run.sessionId,
        run.title,
      );
      return;
    }
    // Session setup itself can fail. There is no exact conversation in that
    // case, so retain the task-scope fallback rather than dropping the action.
    const target = resolveScheduledChatTarget({
      activeView,
      taskId: run.taskId,
      chatRoute,
    });
    if (target.kind === 'dock') {
      dock.openScheduledChat(run.taskId);
      return;
    }
    setLocation(target.path);
  }, [activeView, chatRoute, dock, onOpenSessionInScope, setLocation]));
};
