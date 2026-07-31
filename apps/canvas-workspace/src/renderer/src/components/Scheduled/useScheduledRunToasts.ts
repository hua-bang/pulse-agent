import { useEffect, useRef } from 'react';
import type { ScheduledRunFinished } from '../../../../shared/scheduled';
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
 * `onOpenTask` and `isRunAlreadyVisible` are held in refs so callers can pass
 * inline arrows without resubscribing on every render; routing and the
 * "already on screen" question both stay with the caller. Keeping the second
 * one injected is what lets this hook stay free of the dock provider — it is
 * mounted app-wide and its test harness has no dock.
 */
export const useScheduledRunToasts = (
  onOpenTask: (taskId: string) => void,
  isRunAlreadyVisible?: (run: ScheduledRunFinished) => boolean,
): void => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const openRef = useRef(onOpenTask);
  openRef.current = onOpenTask;
  const visibleRef = useRef(isRunAlreadyVisible);
  visibleRef.current = isRunAlreadyVisible;

  useEffect(() => window.canvasWorkspace.scheduled.onRunFinished((run) => {
    // A manual run already put the user in the conversation and held them
    // there for its whole duration; announcing it on top of the panel they
    // are reading is noise pointing at itself. Failures still speak up — the
    // in-panel error banner is easy to miss, and an unattended run is exactly
    // the case the sticky toast exists for, so `schedule` is never silenced.
    if (run.ok && run.trigger === 'manual' && visibleRef.current?.(run)) return;
    notify({
      tone: run.ok ? 'success' : 'error',
      title: run.ok ? t('scheduled.runFinished', { title: run.title }) : t('scheduled.runFailed'),
      description: run.ok ? undefined : run.error,
      autoCloseMs: 0,
      action: {
        label: t('scheduled.openChat'),
        onClick: () => openRef.current(run.taskId),
      },
    });
  }), [notify, t]);
};
