import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { useAppShell } from '../AppShellProvider';

/**
 * App-wide bridge for the two scheduled-task pushes from main.
 *
 * `scheduled:open-task` (an OS notification click) navigates; the toast on
 * `scheduled:run-finished` is the in-app completion signal — the OS
 * notification alone is not reliable, since Focus modes, missing notification
 * daemons, and unsigned dev builds all drop it silently.
 *
 * `onOpenTask` is held in a ref so callers can pass an inline arrow without
 * resubscribing both channels on every render; routing stays with the caller.
 */
export const useScheduledRunToasts = (onOpenTask: (taskId: string) => void): void => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const openRef = useRef(onOpenTask);
  openRef.current = onOpenTask;

  useEffect(
    () => window.canvasWorkspace.scheduled.onOpenTask((taskId) => openRef.current(taskId)),
    [],
  );

  useEffect(() => window.canvasWorkspace.scheduled.onRunFinished((run) => {
    notify({
      tone: run.ok ? 'success' : 'error',
      title: run.ok ? t('scheduled.runFinished', { title: run.title }) : t('scheduled.runFailed'),
      description: run.ok ? undefined : run.error,
      action: {
        label: t('scheduled.openChat'),
        onClick: () => openRef.current(run.taskId),
      },
    });
  }), [notify, t]);
};
