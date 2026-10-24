import { useEffect, useMemo, useState } from 'react';
import { SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import type { ScheduledTask } from '../../../../../shared/scheduled';
import type { SettingsSection } from '../../settings';
import type { WorkspaceOption } from '../../../types';
import type { AgentScope } from '../../../types';
import { ChatPanelLazy as ChatPanel } from '../../../modules/chat/lazy';
import { useI18n } from '../../../i18n';
import { Button } from '../../../components/ui';
import { localizeBuiltInTasks } from './formatters';
import './index.css';

interface ScheduledChatPanelProps {
  taskId: string;
  /** The run conversation to show; unset shows the task's current one. */
  sessionId?: string;
  revision: number;
  allWorkspaces: WorkspaceOption[];
  onClose: () => void;
  /** Return the dock to the current page's own chat. */
  onLeave: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
  onTurnComplete: () => void;
  chatTargetActive?: boolean;
  onOpenSessionInScope?: (scope: AgentScope, sessionId: string, scopeLabel: string) => void;
}

export const ScheduledChatPanel = ({
  taskId,
  sessionId,
  revision,
  allWorkspaces,
  onClose,
  onLeave,
  onOpenAppSettings,
  onTurnComplete,
  chatTargetActive,
  onOpenSessionInScope,
}: ScheduledChatPanelProps) => {
  const { t } = useI18n();
  const [task, setTask] = useState<ScheduledTask>();
  const agentScope = useMemo(() => ({ kind: 'scheduled' as const, taskId }), [taskId]);

  useEffect(() => {
    let active = true;
    const updateTask = (tasks: ScheduledTask[]) => {
      if (active) setTask(localizeBuiltInTasks(tasks, t).find((candidate) => candidate.id === taskId));
    };
    void window.canvasWorkspace.scheduled.list().then((response) => {
      if (response.ok && response.tasks) updateTask(response.tasks);
    });
    const unsubscribe = window.canvasWorkspace.scheduled.onChanged(updateTask);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [t, taskId]);

  const banner = task?.status === 'running' ? (
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
  // The task chat sits in place of the page's chat, so say so and offer the way back.
  const leaveBar = (
    <div className="scheduled-chat-leave">
      <span>{t('scheduled.taskChatHint')}</span>
      <Button size="xs" onClick={onLeave}>{t('scheduled.backToPageChat')}</Button>
    </div>
  );

  return (
    <ChatPanel
      key={taskId}
      agentScope={agentScope}
      sessionRefreshKey={revision}
      requestedSessionId={sessionId}
      allWorkspaces={allWorkspaces}
      banner={<>{leaveBar}{banner}</>}
      pendingLabel={task?.status === 'running' ? t('scheduled.runningInline') : undefined}
      chatTargetLabel={task?.title}
      onClose={onClose}
      onOpenAppSettings={onOpenAppSettings}
      onTurnComplete={onTurnComplete}
      chatTargetActive={chatTargetActive}
      onOpenSessionInScope={onOpenSessionInScope}
    />
  );
};
