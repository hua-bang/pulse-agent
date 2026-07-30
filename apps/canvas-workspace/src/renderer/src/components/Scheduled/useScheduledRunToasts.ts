import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { useAppShell } from '../AppShellProvider';

/**
 * The completion signal for scheduled runs — in-app only, by design. There is
 * deliberately no OS notification: a scheduled run finishes while the user is
 * elsewhere, and the OS channel is the unreliable one (Focus modes, missing
 * notification daemons, unsigned dev builds all drop it silently).
 *
 * `autoCloseMs: 0` because the whole point is that the user is NOT watching:
 * a toast that expires on a timer reproduces "the run finished and I never
 * saw anything". It stays until dismissed or acted on.
 *
 * `onOpenTask` is held in a ref so callers can pass an inline arrow without
 * resubscribing on every render; routing stays with the caller.
 */
export const useScheduledRunToasts = (onOpenTask: (taskId: string) => void): void => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const openRef = useRef(onOpenTask);
  openRef.current = onOpenTask;

  useEffect(() => window.canvasWorkspace.scheduled.onRunFinished((run) => {
    // A run the user stopped is announced through the same channel as a
    // failure (the engine threw), but it is not a fault — reporting it in the
    // error tone would blame the user for their own click.
    const tone = run.ok ? 'success' : run.cancelled ? 'info' : 'error';
    notify({
      tone,
      title: run.ok
        ? t('scheduled.runFinished', { title: run.title })
        : run.cancelled
          ? t('scheduled.runStopped', { title: run.title })
          : t('scheduled.runFailed'),
      description: run.ok || run.cancelled ? undefined : run.error,
      autoCloseMs: 0,
      action: {
        label: t('scheduled.openChat'),
        onClick: () => openRef.current(run.taskId),
      },
    });
  }), [notify, t]);
};
