import { useCallback, useEffect, useState } from 'react';
import { CalendarBlank, Plus } from '@phosphor-icons/react';
import type { ScheduledTask, ScheduledTaskInput } from '../../../../../shared/scheduled';
import { useI18n } from '../../../i18n';
import { useAppShell } from '../../../shared/appShell';
import { useRightDock } from '../../../shared/dockPort';
import { Button, EmptyState } from '../../../components/ui';
import { TaskEditorModal } from './TaskEditorModal';
import { TaskRow } from './TaskRow';
import './index.css';

/**
 * The Scheduled list. A run's conversation opens in the dock beside it, so
 * the list stays in view while the user reads or follows up on a result.
 */
export const ScheduledPage = () => {
  const { t } = useI18n();
  const dock = useRightDock();
  const { notify, confirm } = useAppShell();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningTaskIds, setRunningTaskIds] = useState<Set<string>>(() => new Set());
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

  const runNow = async (task: ScheduledTask) => {
    if (runningTaskIds.has(task.id) || task.status === 'running') return;
    setRunningTaskIds((current) => new Set(current).add(task.id));
    try {
      const response = await window.canvasWorkspace.scheduled.runNow(task.id);
      if (!response.ok || !response.sessionId) {
        notify({ tone: 'error', title: t('scheduled.runFailed'), description: response.error });
        return;
      }

      dock.openScheduledChat(task.id, response.sessionId);
    } finally {
      setRunningTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
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

  const openResult = (task: ScheduledTask, sessionId: string) => {
    dock.openScheduledChat(task.id, sessionId);
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
            <TaskRow
              key={task.id}
              task={task}
              starting={runningTaskIds.has(task.id)}
              onToggle={(target) => void toggleTask(target)}
              onRunNow={(target) => void runNow(target)}
              onEdit={openEdit}
              onDelete={(target) => void removeTask(target)}
              onOpenResult={openResult}
            />
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
