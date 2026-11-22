import { useCallback, useEffect, useState } from 'react';
import { CalendarBlank, Plus } from '@phosphor-icons/react';
import { GLOBAL_CHAT_STORE_ID } from '../../../../../shared/agent-chat';
import {
  isBuiltInDigestSource,
  type ScheduledTask,
  type ScheduledTaskInput,
} from '../../../../../shared/scheduled';
import { useI18n } from '../../../i18n';
import { useAppShell } from '../../../shared/appShell';
import { useRightDock } from '../../../shared/dockPort';
import { Button, EmptyState, PageHeader } from '../../../components/ui';
import { localizeBuiltInTasks, restoreBuiltInTaskInput } from './formatters';
import { DigestCards } from './DigestCards';
import { TaskEditorModal } from './TaskEditorModal';
import { TaskRow } from './TaskRow';
import { clearPendingDelete, markPendingDelete, usePendingDeletes } from './pendingDeletes';
import './index.css';

/**
 * The Scheduled list. Built-in daily/weekly workspace digests sit at the top
 * as dedicated cards with direct report-artifact access; custom tasks live in
 * the list below.
 */
interface Props {
  /** Ask the side chat about one task; it arrives as a context chip. */
  onAskAi?: (task: ScheduledTask) => void;
}

const digestSortRank = (task: ScheduledTask): number =>
  task.source === 'daily-summary' ? 0 : 1;

export const ScheduledPage = ({ onAskAi }: Props) => {
  const { t } = useI18n();
  const dock = useRightDock();
  const { notify, confirm } = useAppShell();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningTaskIds, setRunningTaskIds] = useState<Set<string>>(() => new Set());
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | undefined>();
  const pendingDeletes = usePendingDeletes();
  const visibleTasks = tasks.filter((task) => !pendingDeletes.has(task.id));
  const digestTasks = visibleTasks
    .filter((task) => isBuiltInDigestSource(task.source))
    .sort((a, b) => digestSortRank(a) - digestSortRank(b));
  const customTasks = visibleTasks.filter((task) => !isBuiltInDigestSource(task.source));

  const load = useCallback(async () => {
    const response = await window.canvasWorkspace.scheduled.list();
    setLoading(false);
    if (!response.ok || !response.tasks) {
      notify({ tone: 'error', title: t('scheduled.loadFailed'), description: response.error });
      return;
    }
    setTasks(localizeBuiltInTasks(response.tasks, t));
  }, [notify, t]);

  useEffect(() => {
    void load();
    return window.canvasWorkspace.scheduled.onChanged((next) => setTasks(localizeBuiltInTasks(next, t)));
  }, [load, t]);

  const saveTask = async (input: ScheduledTaskInput): Promise<boolean> => {
    const response = editingTask
      ? await window.canvasWorkspace.scheduled.update(editingTask.id, restoreBuiltInTaskInput(editingTask, input, t))
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
      intent: 'danger',
      title: t('scheduled.deleteTitle', { title: task.title }),
      description: t('scheduled.deleteDescription'),
      confirmLabel: t('scheduled.deleteTask'),
    });
    if (!accepted) return;
    // Hide the row now and remove the task when the Undo toast closes.
    markPendingDelete(task.id);
    notify({
      tone: 'success',
      title: t('scheduled.deleted'),
      description: task.title,
      autoCloseMs: 8000,
      action: { label: t('app.undoDelete'), onClick: () => clearPendingDelete(task.id) },
      onClose: () => {
        void window.canvasWorkspace.scheduled.remove(task.id).then((response) => {
          clearPendingDelete(task.id);
          if (!response.ok) {
            notify({ tone: 'error', title: t('scheduled.deleteFailed'), description: response.error });
          }
        });
      },
    });
  };

  const openResult = (task: ScheduledTask, sessionId: string) => {
    dock.openScheduledChat(task.id, sessionId);
  };

  const openReport = (artifactId: string) => {
    dock.openArtifact(GLOBAL_CHAT_STORE_ID, artifactId);
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
      <PageHeader
        className="scheduled-page__header"
        kicker={t('scheduled.kicker')}
        title={t('scheduled.title')}
        description={t('scheduled.description')}
        actions={(
          <Button variant="primary" onClick={openCreate}>
            <Plus size={16} />
            {t('scheduled.createTask')}
          </Button>
        )}
      />

      {!loading && visibleTasks.length === 0 ? (
        <EmptyState
          icon={<CalendarBlank size={24} />}
          title={t('scheduled.emptyTitle')}
          description={t('scheduled.emptyDescription')}
          action={<Button variant="primary" onClick={openCreate}>{t('scheduled.createTask')}</Button>}
        />
      ) : (
        <>
          <DigestCards
            tasks={digestTasks}
            runningTaskIds={runningTaskIds}
            onToggle={(target) => void toggleTask(target)}
            onRunNow={(target) => void runNow(target)}
            onEdit={openEdit}
            onOpenReport={openReport}
            onOpenSession={openResult}
            onAskAi={onAskAi}
          />
          {customTasks.length > 0 && (
            <section className="scheduled-page__custom">
              {digestTasks.length > 0 && (
                <div className="scheduled-digest__heading">
                  <h2>{t('scheduled.digest.customTasksTitle')}</h2>
                </div>
              )}
              <ul className="scheduled-page__list">
                {customTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    starting={runningTaskIds.has(task.id)}
                    onToggle={(target) => void toggleTask(target)}
                    onRunNow={(target) => void runNow(target)}
                    onEdit={openEdit}
                    onDelete={(target) => void removeTask(target)}
                    onOpenResult={openResult}
                    onAskAi={onAskAi}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
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
