import {
  ArrowSquareOut,
  CalendarBlank,
  CheckCircle,
  ClockClockwise,
  FileText,
  Pause,
  PencilSimple,
  Play,
  Sparkle,
  SpinnerGap,
  WarningCircle,
} from '@phosphor-icons/react';
import type { ScheduledTask } from '../../../../../shared/scheduled';
import { useI18n } from '../../../i18n';
import { Button } from '../../../components/ui';
import { scheduleLabel, timeLabel } from './formatters';

interface Props {
  tasks: ScheduledTask[];
  runningTaskIds: Set<string>;
  onToggle: (task: ScheduledTask) => void;
  onRunNow: (task: ScheduledTask) => void;
  onEdit: (task: ScheduledTask) => void;
  onOpenReport: (artifactId: string) => void;
  onOpenSession: (task: ScheduledTask, sessionId: string) => void;
  onAskAi?: (task: ScheduledTask) => void;
}

const latestArtifactId = (task: ScheduledTask): string | undefined => {
  if (task.lastError || !task.lastArtifactId || !task.lastSuccessAt) return undefined;
  return task.lastArtifactId;
};

const latestSessionId = (task: ScheduledTask): string | undefined => {
  if (task.lastError || !task.lastSessionId || !task.lastSuccessAt) return undefined;
  return task.lastSessionId;
};

const DigestStatus = ({ task, running }: { task: ScheduledTask; running: boolean }) => {
  const { t } = useI18n();

  if (running) {
    return (
      <span className="scheduled-digest__status scheduled-digest__status--running" role="status">
        <SpinnerGap className="scheduled-spin" size={13} />
        {t('scheduled.runningShort')}
      </span>
    );
  }

  if (task.lastError) {
    return (
      <span className="scheduled-digest__status scheduled-digest__status--failed" title={task.lastError}>
        <WarningCircle size={13} weight="fill" />
        {t('scheduled.lastFailed', { time: timeLabel(task.lastAttemptAt, t('scheduled.never')) })}
      </span>
    );
  }

  if (task.lastSkippedAt && (!task.lastSuccessAt || task.lastSkippedAt >= task.lastSuccessAt)) {
    return (
      <span className="scheduled-digest__status scheduled-digest__status--skipped">
        <ClockClockwise size={13} />
        {t('scheduled.lastSkipped', { time: timeLabel(task.lastSkippedAt, t('scheduled.never')) })}
      </span>
    );
  }

  if (task.lastSuccessAt) {
    return (
      <span className="scheduled-digest__status scheduled-digest__status--success">
        <CheckCircle size={13} weight="fill" />
        {t('scheduled.lastSuccess', { time: timeLabel(task.lastSuccessAt, t('scheduled.never')) })}
      </span>
    );
  }

  return (
    <span className="scheduled-digest__status">
      {t('scheduled.neverRun')}
    </span>
  );
};

export const DigestCards = ({
  tasks,
  runningTaskIds,
  onToggle,
  onRunNow,
  onEdit,
  onOpenReport,
  onOpenSession,
  onAskAi,
}: Props) => {
  const { t, language } = useI18n();
  if (tasks.length === 0) return null;

  return (
    <section className="scheduled-digest" aria-label={t('scheduled.digest.sectionTitle')}>
      <div className="scheduled-digest__heading">
        <h2>{t('scheduled.digest.sectionTitle')}</h2>
      </div>
      <div className="scheduled-digest__grid">
        {tasks.map((task) => {
          const running = runningTaskIds.has(task.id) || task.status === 'running';
          const isDaily = task.source === 'daily-summary';
          const artifactId = latestArtifactId(task);
          const sessionId = latestSessionId(task);
          const subtitle = isDaily
            ? t('scheduled.dailySummary.subtitle')
            : t('scheduled.memoryReport.subtitle');

          return (
            <article
              key={task.id}
              className={`scheduled-digest__card${task.enabled ? '' : ' scheduled-digest__card--paused'}`}
              data-task-id={task.id}
            >
              <div className="scheduled-digest__top">
                <div className="scheduled-digest__title-wrap">
                  <span className="scheduled-digest__icon" aria-hidden="true">
                    {isDaily ? <ClockClockwise size={17} /> : <CalendarBlank size={17} />}
                  </span>
                  <div className="scheduled-digest__title-group">
                    <div className="scheduled-digest__title-row">
                      <strong>{task.title}</strong>
                      <span
                        className={`scheduled-page__status${task.enabled ? ' scheduled-page__status--enabled' : ''}`}
                        title={task.enabled ? t('scheduled.active') : t('scheduled.paused')}
                      />
                    </div>
                    <p className="scheduled-digest__subtitle">{subtitle}</p>
                  </div>
                </div>
                <Button
                  variant="icon"
                  size="sm"
                  aria-label={task.enabled ? t('scheduled.pause') : t('scheduled.resume')}
                  title={task.enabled ? t('scheduled.pause') : t('scheduled.resume')}
                  onClick={() => onToggle(task)}
                >
                  {task.enabled ? <Pause size={14} /> : <Play size={14} />}
                </Button>
              </div>

              <div className="scheduled-digest__meta">
                <span>
                  {scheduleLabel(task.schedule, t, language)}
                  {' · '}
                  {task.enabled
                    ? t('scheduled.nextRun', { time: timeLabel(task.nextRunAt, t('scheduled.never')) })
                    : t('scheduled.paused')}
                </span>
                <DigestStatus task={task} running={running} />
              </div>

              <div className="scheduled-digest__actions">
                {artifactId && (
                  <Button
                    size="xs"
                    variant="primary"
                    onClick={() => onOpenReport(artifactId)}
                  >
                    <FileText size={13} />
                    {t('scheduled.openReport')}
                  </Button>
                )}
                {sessionId && (
                  <Button
                    size="xs"
                    onClick={() => onOpenSession(task, sessionId)}
                  >
                    <ArrowSquareOut size={13} />
                    {t('scheduled.openChat')}
                  </Button>
                )}
                <Button
                  size="xs"
                  disabled={running}
                  aria-label={running ? t('scheduled.running') : t('scheduled.runNow')}
                  title={running ? t('scheduled.running') : t('scheduled.runNow')}
                  onClick={() => onRunNow(task)}
                >
                  {running ? <SpinnerGap className="scheduled-spin" size={13} /> : <Play size={13} />}
                  {running ? t('scheduled.runningShort') : t('scheduled.runNow')}
                </Button>
                <div className="scheduled-digest__actions-end">
                  {onAskAi && (
                    <Button
                      variant="icon"
                      size="sm"
                      aria-label={t('scheduled.askAi')}
                      title={t('scheduled.askAi')}
                      onClick={() => onAskAi(task)}
                    >
                      <Sparkle size={14} />
                    </Button>
                  )}
                  <Button
                    variant="icon"
                    size="sm"
                    aria-label={t('scheduled.editTask')}
                    title={t('scheduled.editTask')}
                    onClick={() => onEdit(task)}
                  >
                    <PencilSimple size={14} />
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
