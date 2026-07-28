import { useEffect, useRef, useState } from 'react';
import type { ScheduledRunProgress, ScheduledTask } from '../../../../shared/scheduled';

export interface ScheduledRunStatus {
  /** Latest pushed activity; undefined until the first push of a run lands. */
  progress?: ScheduledRunProgress;
  /** Time since the run started; undefined when the task is not running. */
  elapsedMs?: number;
}

/**
 * Every in-flight run, keyed by task id.
 *
 * Two sources, because neither alone covers a run: the pushes carry what the
 * agent is doing but only from the moment this subscribes, so a surface
 * mounted mid-run reads the main-process snapshot first.
 */
export const useActiveScheduledRuns = (): Record<string, ScheduledRunProgress> => {
  const [runs, setRuns] = useState<Record<string, ScheduledRunProgress>>({});
  const pushedRef = useRef(new Set<string>());

  useEffect(() => {
    let active = true;

    void window.canvasWorkspace.scheduled.progress().then((response) => {
      if (!active || !response.ok || !response.runs) return;
      setRuns((current) => {
        const next = { ...current };
        for (const run of response.runs!) {
          // A push that arrived while the snapshot was in flight is newer
          // than the snapshot; never let the slower answer win.
          if (!pushedRef.current.has(run.taskId)) next[run.taskId] = run;
        }
        return next;
      });
    });

    const stopProgress = window.canvasWorkspace.scheduled.onRunProgress((progress) => {
      pushedRef.current.add(progress.taskId);
      setRuns((current) => ({ ...current, [progress.taskId]: progress }));
    });
    const stopFinished = window.canvasWorkspace.scheduled.onRunFinished((run) => {
      pushedRef.current.add(run.taskId);
      setRuns((current) => {
        if (!current[run.taskId]) return current;
        const next = { ...current };
        delete next[run.taskId];
        return next;
      });
    });

    return () => {
      active = false;
      stopProgress();
      stopFinished();
    };
  }, []);

  return runs;
};

/** Re-renders once a second while `active`, so elapsed times stay live. */
export const useRunClock = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  return now;
};

/**
 * Run status for one task. `lastAttemptAt` is the fallback start time so the
 * elapsed clock is honest even before the first progress push lands.
 */
export const scheduledRunStatus = (
  task: ScheduledTask | undefined,
  runs: Record<string, ScheduledRunProgress>,
  now: number,
): ScheduledRunStatus => {
  if (!task || task.status !== 'running') return {};
  const progress = runs[task.id];
  const startedAt = progress?.startedAt ?? task.lastAttemptAt;
  return {
    progress,
    elapsedMs: startedAt === undefined ? undefined : Math.max(0, now - startedAt),
  };
};

/** Single-task convenience wrapper over the three pieces above. */
export const useScheduledRunProgress = (task: ScheduledTask | undefined): ScheduledRunStatus => {
  const runs = useActiveScheduledRuns();
  const now = useRunClock(task?.status === 'running');
  return scheduledRunStatus(task, runs, now);
};
