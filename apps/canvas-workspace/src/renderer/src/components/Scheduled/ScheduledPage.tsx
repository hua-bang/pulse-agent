import { useCallback, useEffect, useState } from 'react';
import {
  CalendarBlank,
  ChatCircleDots,
  PencilSimple,
  Play,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import type { ScheduledTask, ScheduledTaskInput } from '../../../../shared/scheduled';
import { useI18n } from '../../i18n';
import { useAppShell } from '../AppShellProvider';
import { Button, EmptyState } from '../ui';
import { TaskEditorModal } from './TaskEditorModal';
import './index.css';

interface Props {
  onOpenTask: (taskId: string) => void;
}

const intervalLabel = (minutes: number, t: ReturnType<typeof useI18n>['t']): string => {
  if (minutes === 30) return t('scheduled.interval.30m');
  if (minutes === 60) return t('scheduled.interval.1h');
  if (minutes === 360) return t('scheduled.interval.6h');
  if (minutes === 1440) return t('scheduled.interval.daily');
  if (minutes === 10080) return t('scheduled.interval.weekly');
  return t('scheduled.interval.custom', { minutes });
};

const timeLabel = (value: number | undefined, fallback: string): string => {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
};

export const ScheduledPage = ({ onOpenTask }: Props) => {
  const { t } = useI18n();
  const { notify, confirm } = useAppShell();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | undefined>();

  const load = useCallback(async () => {
    const response = await window.canvasWorkspace.scheduled.list();
    setLoading(false);
    if (!response.ok || !response.tasks) {
      notify({ tone: 'error', title: t('scheduled.loadFailed'), description: response.error });
      return;
    }
    setTasks(response.tasks);
  }, [notify, t]);

  useEffect(() => {
    void load();
    return window.canvasWorkspace.scheduled.onChanged(setTasks);
  }, [load]);

  const saveTask = async (input: ScheduledTaskInput): Promise<boolean> => {
    const response = editingTask
      ? await window.canvasWorkspace.scheduled.update(editingTask.id, input)
      : await window.canvasWorkspace.scheduled.create(input);
    if (!response.ok || !response.task) {
      notify({ tone: 'error', title: t('scheduled.saveFailed'), description: response.error });
      return false;
    }
    await load();
    notify({
      tone: 'success',
      title: editingTask ? t('scheduled.updated') : t('scheduled.created'),
      description: response.task.title,
    });
    return true;
  };

  const toggleTask = async (task: ScheduledTask) => {
    const response = await window.canvasWorkspace.scheduled.update(task.id, { enabled: !task.enabled });
    if (!response.ok) {
      notify({ tone: 'error', title: t('scheduled.saveFailed'), description: response.error });
    }
  };

  const runNow = (task: ScheduledTask) => {
    onOpenTask(task.id);
    void window.canvasWorkspace.scheduled.runNow(task.id).then((response) => {
      if (!response.ok) {
        notify({ tone: 'error', title: t('scheduled.runFailed'), description: response.error });
      }
    });
  };

  const removeTask = async (task: ScheduledTask) => {
    const accepted = await confirm({
      title: t('scheduled.deleteTitle', { title: task.title }),
      description: t('scheduled.deleteDescription'),
      confirmLabel: t('scheduled.deleteTask'),
    });
    if (!accepted) return;
    const response = await window.canvasWorkspace.scheduled.remove(task.id);
    if (!response.ok) {
      notify({ tone: 'error', title: t('scheduled.deleteFailed'), description: response.error });
    }
  };

  const openCreate = () => {
    setEditingTask(undefined);
    setEditorOpen(true);
  };

  const openEdit = (task: ScheduledTask) => {
    setEditingTask(task);
    setEditorOpen(true);
  };

  return (
    <main className="scheduled-page">
      <header className="scheduled-page__header">
        <div>
          <span>{t('scheduled.kicker')}</span>
          <h1>{t('scheduled.title')}</h1>
          <p>{t('scheduled.description')}</p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={16} />
          {t('scheduled.createTask')}
        </Button>
      </header>

      {!loading && tasks.length === 0 ? (
        <EmptyState
          icon={<CalendarBlank size={24} />}
          title={t('scheduled.emptyTitle')}
          description={t('scheduled.emptyDescription')}
          action={<Button variant="primary" onClick={openCreate}>{t('scheduled.createTask')}</Button>}
        />
      ) : (
        <ul className="scheduled-page__list">
          {tasks.map((task) => (
            <li key={task.id} className="scheduled-page__row">
              <Button
                className="scheduled-page__row-main"
                data-task-id={task.id}
                onClick={() => onOpenTask(task.id)}
              >
                <span className={`scheduled-page__status${task.enabled ? ' scheduled-page__status--enabled' : ''}`} />
                <span className="scheduled-page__row-copy">
                  <strong>{task.title}</strong>
                  <small>{task.prompt}</small>
                </span>
                <span className="scheduled-page__meta">
                  <span>{intervalLabel(task.intervalMinutes, t)}</span>
                  <small>
                    {task.enabled
                      ? t('scheduled.nextRun', { time: timeLabel(task.nextRunAt, t('scheduled.never')) })
                      : t('scheduled.paused')}
                  </small>
                </span>
                <span className="scheduled-page__last-run">
                  {task.lastError
                    ? t('scheduled.lastFailed', { time: timeLabel(task.lastAttemptAt, t('scheduled.never')) })
                    : task.lastSuccessAt
                      ? t('scheduled.lastSuccess', { time: timeLabel(task.lastSuccessAt, t('scheduled.never')) })
                      : t('scheduled.neverRun')}
                </span>
                <ChatCircleDots size={17} />
              </Button>
              <div className="scheduled-page__row-actions">
                <Button size="xs" onClick={() => void toggleTask(task)}>
                  {task.enabled ? t('scheduled.pause') : t('scheduled.resume')}
                </Button>
                <Button variant="icon" size="sm" aria-label={t('scheduled.runNow')} onClick={() => runNow(task)}>
                  <Play size={14} />
                </Button>
                <Button variant="icon" size="sm" aria-label={t('scheduled.editTask')} onClick={() => openEdit(task)}>
                  <PencilSimple size={14} />
                </Button>
                {task.source === 'user' && (
                  <Button variant="icon" size="sm" aria-label={t('scheduled.deleteTask')} onClick={() => void removeTask(task)}>
                    <Trash size={14} />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <TaskEditorModal
        open={editorOpen}
        task={editingTask}
        onClose={() => setEditorOpen(false)}
        onSave={saveTask}
      />
    </main>
  );
};
