import { useCallback, useEffect } from 'react';
import { useLocation } from 'wouter';
import { GLOBAL_CHAT_STORE_ID } from '../../../../../shared/agent-chat';
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
 * Wires the scheduled-run completion toast to the exact artifact or
 * conversation that produced it. Built-in digests that produce an HTML report
 * artifact open directly in the Dock artifact viewer; regular scheduled runs
 * open their exact conversation session.
 */
export const useScheduledRunChatOpener = ({
  activeView,
  chatRoute,
  onOpenSessionInScope,
}: Options): void => {
  const dock = useRightDock();
  const [, setLocation] = useLocation();
  useEffect(() => window.canvasWorkspace.scheduled.onRunFinished((run) => {
    if (run.skipped) return;
    // Refresh is a no-op unless this task is already visible in the Dock. It
    // keeps Run now live without pulling a background task into view.
    dock.refreshScheduledChat(run.taskId);
    // When a manual digest run finishes with a rendered report artifact, open
    // the clean report view right away so the user doesn't have to dig raw HTML
    // out of the chat transcript.
    if (run.trigger === 'manual' && run.ok && run.artifactId) {
      dock.openArtifact(GLOBAL_CHAT_STORE_ID, run.artifactId);
    }
  }), [dock]);
  useScheduledRunToasts(useCallback((run: ScheduledRunFinished) => {
    if (run.ok && run.artifactId) {
      dock.openArtifact(GLOBAL_CHAT_STORE_ID, run.artifactId);
      return;
    }
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
