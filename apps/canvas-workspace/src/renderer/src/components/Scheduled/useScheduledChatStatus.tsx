import type { ReactNode } from 'react';
import { SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import type { ScheduledTask } from '../../../../shared/scheduled';
import { useI18n } from '../../i18n';
import { runStatusLine } from './formatters';
import { useScheduledRunProgress } from './useScheduledRunProgress';

export interface ScheduledChatStatus {
  /** Banner for the top of the task's chat surface. */
  banner?: ReactNode;
  /** In-conversation placeholder shown while the run is in flight. */
  pendingLabel?: string;
}

/**
 * The shared "what is this run doing" view model for a scheduled task's chat,
 * used by both the dock panel and the full-page chat so the two never drift.
 *
 * The banner used to be a fixed sentence for the whole run, which for a
 * multi-minute task is indistinguishable from a wedged one; the elapsed timer
 * and activity line replace that with something that visibly moves.
 */
export const useScheduledChatStatus = (task: ScheduledTask | undefined): ScheduledChatStatus => {
  const { t } = useI18n();
  const running = task?.status === 'running';
  const { progress, elapsedMs } = useScheduledRunProgress(task);

  if (running) {
    const statusLine = runStatusLine(progress, elapsedMs, t);
    return {
      banner: (
        <div className="scheduled-chat-status" role="status">
          <SpinnerGap className="scheduled-spin" size={15} />
          <span>
            <strong>{t('scheduled.running')}</strong>
            {/* The elapsed clock reticks every second; announcing that on a
                loop would make the live region unusable. */}
            <small className="scheduled-chat-status__activity" aria-live="off">{statusLine}</small>
            <small>{t('scheduled.runningHint')}</small>
          </span>
        </div>
      ),
      pendingLabel: statusLine,
    };
  }

  if (task?.lastError) {
    return {
      banner: (
        <div className="scheduled-chat-status scheduled-chat-status--error" role="alert">
          <WarningCircle size={15} />
          <span>
            <strong>{t('scheduled.runFailed')}</strong>
            <small>{task.lastError}</small>
          </span>
        </div>
      ),
    };
  }

  return {};
};
