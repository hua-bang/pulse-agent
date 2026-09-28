import {
  ArrowSquareOut,
  CalendarCheck,
  CheckCircle,
  Pause,
  PencilSimple,
  Play,
  SpinnerGap,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import type { ScheduledTask } from '../../../../../shared/scheduled';
import { useI18n } from '../../../i18n';
import { Button } from '../../../components/ui';
import { scheduleLabel, timeLabel } from './formatters';

interface Props {
  task: ScheduledTask;
  /** A manual start is in flight; the task record may not say `running` yet. */
  starting: boolean;
  onToggle: (task: ScheduledTask) => void;
  onRunNow: (task: ScheduledTask) => void;
  onEdit: (task: ScheduledTask) => void;
  onDelete: (task: ScheduledTask) => void;
  onOpenResult: (task: ScheduledTask, sessionId: string) => void;
}

/**
 * The session to open from the last-run cell. Only the LATEST attempt's own
 * successful conversation qualifies: after a failure `lastSessionId` still
 * points at an older success, and linking "Failed …" to that run would show
 * the wrong result.
 */
const latestResultSessionId = (task: ScheduledTask): string | undefined => {
  if (task.lastError || !task.lastSessionId || !task.lastSuccessAt) return undefined;
  if (task.lastAttemptAt && task.lastAttemptAt !== task.lastSuccessAt) return undefined;
  return task.lastSessionId;
};

const LastRun = ({ task, running, onOpenResult }: {
  task: ScheduledTask;
  running: boolean;
  onOpenResult: Props['onOpenResult'];
}) => {
  const { t } = useI18n();

  if (running) {
    return (
      <span className="scheduled-page__last-run scheduled-page__last-run--running" role="status">
        <SpinnerGap className="scheduled-spin" size={13} />
        {t('scheduled.runningShort')}
      </span>
    );
  }

  if (task.lastError) {
    return (
      <span className="scheduled-page__last-run scheduled-page__last-run--failed" title={task.lastError}>
        <span className="scheduled-page__last-run-label">
          <WarningCircle size={13} weight="fill" />
          {t('scheduled.lastFailed', { time: timeLabel(task.lastAttemptAt, t('scheduled.never')) })}
        </span>
        <small>{task.lastError}</small>
      </span>
    );
  }

  if (!task.lastSuccessAt) {
    return <span className="scheduled-page__last-run">{t('scheduled.neverRun')}</span>;
  }

  const label = t('scheduled.lastSuccess', { time: timeLabel(task.lastSuccessAt, t('scheduled.never')) });
  const sessionId = latestResultSessionId(task);
  if (!sessionId) {
    return (
      <span className="scheduled-page__last-run">
        <span className="scheduled-page__last-run-label">
          <CheckCircle size={13} weight="fill" />
          {label}
        </span>
      </span>
    );
  }

  return (
    <span className="scheduled-page__last-run">
      <Button
        size="xs"
        className="scheduled-page__result-link"
        title={t('scheduled.openResult')}
        onClick={() => onOpenResult(task, sessionId)}
      >
        <CheckCircle size={13} weight="fill" />
        {label}
        <ArrowSquareOut size={12} />
      </Button>
    </span>
  );
};

export const TaskRow = ({
  task,
  starting,
  onToggle,
  onRunNow,
  onEdit,
  onDelete,
  onOpenResult,
}: Props) => {
  const { t, language } = useI18n();
  const running = starting || task.status === 'running';
  const rowClass = `scheduled-page__row${task.enabled ? '' : ' scheduled-page__row--paused'}`;

  return (
    <li className={rowClass} data-task-id={task.id}>
      {/* Presentational only. The whole row used to be one button, so every
          stray click on the title or the cadence text opened a chat; actions
          live exclusively in explicit buttons. */}
      <div className="scheduled-page__row-main">
        <span
          className={`scheduled-page__status${task.enabled ? ' scheduled-page__status--enabled' : ''}`}
          title={task.enabled ? t('scheduled.active') : t('scheduled.paused')}
        />
        <span className="scheduled-page__row-copy">
          <strong>{task.title}</strong>
          <small title={task.prompt}>{task.prompt}</small>
        </span>
        <span className="scheduled-page__meta">
          <span>{scheduleLabel(task.schedule, t, language)}</span>
          <small>
            {task.enabled
              ? t('scheduled.nextRun', { time: timeLabel(task.nextRunAt, t('scheduled.never')) })
              : t('scheduled.paused')}
          </small>
        </span>
        <LastRun task={task} running={running} onOpenResult={onOpenResult} />
      </div>
      <div className="scheduled-page__row-actions">
        <Button
          size="xs"
          aria-label={running ? t('scheduled.running') : t('scheduled.runNow')}
          title={running ? t('scheduled.running') : t('scheduled.runNow')}
          disabled={running}
          onClick={() => onRunNow(task)}
        >
          {running ? <SpinnerGap className="scheduled-spin" size={13} /> : <Play size={13} />}
          {running ? t('scheduled.runningShort') : t('scheduled.runNow')}
        </Button>
        <Button
          variant="icon"
          size="sm"
          aria-label={task.enabled ? t('scheduled.pause') : t('scheduled.resume')}
          title={task.enabled ? t('scheduled.pause') : t('scheduled.resume')}
          onClick={() => onToggle(task)}
        >
          {task.enabled ? <Pause size={15} /> : <CalendarCheck size={15} />}
        </Button>
        <Button
          variant="icon"
          size="sm"
          aria-label={t('scheduled.editTask')}
          title={t('scheduled.editTask')}
          onClick={() => onEdit(task)}
        >
          <PencilSimple size={15} />
        </Button>
        {task.source === 'user' ? (
          <Button
            variant="icon"
            size="sm"
            className="scheduled-page__delete"
            aria-label={t('scheduled.deleteTask')}
            title={t('scheduled.deleteTask')}
            onClick={() => onDelete(task)}
          >
            <Trash size={15} />
          </Button>
        ) : (
          // Built-in tasks cannot be deleted; hold the slot so every row's
          // actions line up.
          <span className="scheduled-page__action-spacer" aria-hidden="true" />
        )}
      </div>
    </li>
  );
};
