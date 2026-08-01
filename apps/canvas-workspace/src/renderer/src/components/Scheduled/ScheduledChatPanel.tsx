import { useEffect, useMemo, useState } from 'react';
import { ArrowUUpLeft, CalendarCheck, SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import type { ScheduledTask } from '../../../../shared/scheduled';
import type { SettingsSection } from '../Settings';
import type { WorkspaceOption } from '../chat/types';
import type { AgentScope } from '../chat/types';
import { ChatPanelLazy as ChatPanel } from '../chat/lazy';
import { Button } from '../ui';
import { useI18n } from '../../i18n';
import { scheduleLabel } from './formatters';
import './index.css';

interface ScheduledChatPanelProps {
  taskId: string;
  revision: number;
  allWorkspaces: WorkspaceOption[];
  onClose: () => void;
  /** Leaves the task conversation for the dock's ordinary Pulse AI chat. */
  onExitTaskChat: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
  onTurnComplete: () => void;
  onOpenSessionInScope?: (scope: AgentScope, sessionId: string, scopeLabel: string) => void;
}

export const ScheduledChatPanel = ({
  taskId,
  revision,
  allWorkspaces,
  onClose,
  onExitTaskChat,
  onOpenAppSettings,
  onTurnComplete,
  onOpenSessionInScope,
}: ScheduledChatPanelProps) => {
  const { t, language } = useI18n();
  const [task, setTask] = useState<ScheduledTask>();
  const agentScope = useMemo(() => ({ kind: 'scheduled' as const, taskId }), [taskId]);

  useEffect(() => {
    let active = true;
    const updateTask = (tasks: ScheduledTask[]) => {
      if (active) setTask(tasks.find((candidate) => candidate.id === taskId));
    };
    void window.canvasWorkspace.scheduled.list().then((response) => {
      if (response.ok && response.tasks) updateTask(response.tasks);
    });
    const unsubscribe = window.canvasWorkspace.scheduled.onChanged(updateTask);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [taskId]);

  const status = task?.status === 'running' ? (
    <div className="scheduled-chat-status" role="status">
      <SpinnerGap className="scheduled-spin" size={15} />
      <span>
        <strong>{t('scheduled.running')}</strong>
        <small>{t('scheduled.runningHint')}</small>
      </span>
    </div>
  ) : task?.lastError ? (
    <div className="scheduled-chat-status scheduled-chat-status--error" role="alert">
      <WarningCircle size={15} />
      <span>
        <strong>{t('scheduled.runFailed')}</strong>
        <small>{task.lastError}</small>
      </span>
    </div>
  ) : undefined;

  /**
   * Always shown, not only while a run is in flight or failed.
   *
   * `scheduledChatTaskId` is a persistent dock override: once set, the pinned
   * Pulse AI tab shows THIS conversation until something calls `openChat`, and
   * that tab keeps its generic "Pulse AI" label. Re-clicking the tab merely
   * re-selects the same task chat, so a user who arrived from a completion
   * toast had nothing telling them which conversation they were in and no way
   * out — except the toolbar chat button, which collapses the dock on the
   * first press and only clears the override on the second. This strip is
   * that missing label and that missing exit; run status hangs off it instead
   * of replacing it.
   */
  const banner = (
    <div className="scheduled-chat-banner">
      <div className="scheduled-chat-identity">
        <CalendarCheck size={14} />
        <span className="scheduled-chat-identity__text">
          <strong>{t('scheduled.automationLabel', { title: task?.title ?? taskId })}</strong>
          {task && (
            <small>
              {t('scheduled.automationCadence', {
                cadence: scheduleLabel(task.schedule, t, language),
              })}
            </small>
          )}
        </span>
        <Button size="xs" title={t('scheduled.exitTaskChat')} onClick={onExitTaskChat}>
          <ArrowUUpLeft size={13} />
          {t('scheduled.exitTaskChat')}
        </Button>
      </div>
      {status}
    </div>
  );

  return (
    <ChatPanel
      key={taskId}
      agentScope={agentScope}
      sessionRefreshKey={revision}
      allWorkspaces={allWorkspaces}
      banner={banner}
      pendingLabel={task?.status === 'running' ? t('scheduled.runningInline') : undefined}
      chatTargetLabel={task?.title}
      onClose={onClose}
      onOpenAppSettings={onOpenAppSettings}
      onTurnComplete={onTurnComplete}
      onOpenSessionInScope={onOpenSessionInScope}
    />
  );
};
