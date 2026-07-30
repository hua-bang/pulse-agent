import { useEffect, useRef, useState } from 'react';
import type { ScheduledRunProgress } from '../../../../shared/scheduled';

/**
 * Live progress of a task's in-flight background run.
 *
 * Two sources on purpose. The push (`onRunProgress`) only covers what happens
 * after subscribing, and a scheduled run starts while nobody is watching — so
 * the snapshot is what lets a panel opened mid-run show the current step
 * instead of waiting for the next event, which may be minutes away (or never,
 * for a run that is already writing its answer).
 */
export const useScheduledRunProgress = (taskId: string): ScheduledRunProgress | undefined => {
  const [progress, setProgress] = useState<ScheduledRunProgress>();
  // A `done` event that arrives before the snapshot resolves must win, or the
  // late reply resurrects a finished run and the banner never clears.
  const endedRef = useRef(false);

  useEffect(() => {
    let active = true;
    endedRef.current = false;
    setProgress(undefined);

    void window.canvasWorkspace.scheduled.getRunProgress(taskId).then((response) => {
      if (!active || endedRef.current) return;
      if (response.ok && response.progress) setProgress(response.progress);
    });

    const unsubscribe = window.canvasWorkspace.scheduled.onRunProgress((next) => {
      if (!active || next.taskId !== taskId) return;
      if (next.phase === 'done') {
        endedRef.current = true;
        setProgress(undefined);
        return;
      }
      setProgress(next);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [taskId]);

  return progress;
};

/**
 * Milliseconds since `startedAt`, re-rendering once a second while a run is in
 * flight. Undefined start = no run, and then no timer either: an idle panel
 * must not tick.
 */
export const useElapsedMs = (startedAt: number | undefined): number | undefined => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return startedAt ? Math.max(0, now - startedAt) : undefined;
};
