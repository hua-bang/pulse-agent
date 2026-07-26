import { useCallback, useEffect, useState } from 'react';
import { Pause, Play } from '@phosphor-icons/react';
import type { ScheduledTask } from '../../../../shared/scheduled';
import { useI18n } from '../../i18n';
import type { SettingsSection } from '../Settings';
import { useAppShell } from '../AppShellProvider';
import { ChatPageBody } from '../chat/ChatPageBody';
import { Button } from '../ui';
import './index.css';

interface Props {
  taskId: string;
  onExit: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
}

const cadence = (minutes: number): string => {
  if (minutes === 30) return '30m';
  if (minutes % (7 * 24 * 60) === 0) return `${minutes / (7 * 24 * 60)}w`;
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
};

export const ScheduledTaskChatPage = ({ taskId, onExit, onOpenAppSettings }: Props) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const [task, setTask] = useState<ScheduledTask | null>(null);

  const load = useCallback(async () => {
    const response = await window.canvasWorkspace.scheduled.list();
    if (!response.ok || !response.tasks) {
      notify({ tone: 'error', title: t('scheduled.loadFailed'), description: response.error });
      return;
    }
    const next = response.tasks.find((candidate) => candidate.id === taskId);
    if (!next) {
      onExit();
      return;
    }
    setTask(next);
  }, [notify, onExit, t, taskId]);

  useEffect(() => {
    void load();
    return window.canvasWorkspace.scheduled.onChanged((tasks) => {
      const next = tasks.find((candidate) => candidate.id === taskId);
      if (next) setTask(next);
    });
  }, [load, taskId]);

  if (!task) return null;

  const runNow = async () => {
    const response = await window.canvasWorkspace.scheduled.runNow(task.id);
    if (!response.ok) {
      notify({ tone: 'error', title: t('scheduled.runFailed'), description: response.error });
    }
  };

  const toggle = async () => {
    const response = await window.canvasWorkspace.scheduled.update(task.id, { enabled: !task.enabled });
    if (!response.ok) {
      notify({ tone: 'error', title: t('scheduled.saveFailed'), description: response.error });
    }
  };

  const banner = (
    <section className="scheduled-chat-banner">
      <div className="scheduled-chat-banner__meta">
        <span>{t('scheduled.automationLabel', { title: task.title })}</span>
        <span>{t('scheduled.automationId', { id: task.id })}</span>
        <span>{t('scheduled.automationCadence', { cadence: cadence(task.intervalMinutes) })}</span>
        <span>
          {task.lastSuccessAt
            ? t('scheduled.automationLastRun', {
                time: new Intl.DateTimeFormat(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(task.lastSuccessAt),
              })
            : t('scheduled.automationNeverRun')}
        </span>
      </div>
      <p>{task.prompt}</p>
      <div className="scheduled-chat-banner__actions">
        <Button size="sm" onClick={() => void toggle()}>
          {task.enabled ? <Pause size={14} /> : <Play size={14} />}
          {task.enabled ? t('scheduled.pause') : t('scheduled.resume')}
        </Button>
        <Button variant="primary" size="sm" disabled={task.status === 'running'} onClick={() => void runNow()}>
          <Play size={14} />
          {task.status === 'running' ? t('scheduled.running') : t('scheduled.runNow')}
        </Button>
      </div>
    </section>
  );

  return (
    <ChatPageBody
      key={`${task.id}:${task.lastAttemptAt ?? 0}:${task.lastSuccessAt ?? 0}:${task.lastError ?? ''}`}
      agentScope={{ kind: 'scheduled', taskId: task.id }}
      initialPendingSessionId={null}
      pendingSessionId={null}
      onSessionConsumed={() => undefined}
      onSelectSession={() => undefined}
      onNewGlobalSession={() => undefined}
      newSessionRequest={0}
      allWorkspaces={[]}
      onExit={onExit}
      railCollapsed
      onToggleRail={() => undefined}
      onOpenAppSettings={onOpenAppSettings}
      fixedChat={{ title: task.title, banner: task.lastAttemptAt ? undefined : banner }}
    />
  );
};
