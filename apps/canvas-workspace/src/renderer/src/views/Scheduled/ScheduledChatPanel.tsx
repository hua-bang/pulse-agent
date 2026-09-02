import { useEffect, useMemo, useState } from 'react';
import { SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import type { ScheduledTask } from '../../../../shared/scheduled';
import type { SettingsSection } from '../../components/settings/Settings';
import type { WorkspaceOption } from '../../types';
import type { AgentScope } from '../../types';
import { ChatPanelLazy as ChatPanel } from '../../components/chat/lazy';
import { useI18n } from '../../i18n';
import './index.css';

interface ScheduledChatPanelProps {
  taskId: string;
  revision: number;
  allWorkspaces: WorkspaceOption[];
  onClose: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
  onTurnComplete: () => void;
  chatTargetActive?: boolean;
  onOpenSessionInScope?: (scope: AgentScope, sessionId: string, scopeLabel: string) => void;
}

export const ScheduledChatPanel = ({
  taskId,
  revision,
  allWorkspaces,
  onClose,
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
      chatTargetActive={chatTargetActive}
      onOpenSessionInScope={onOpenSessionInScope}
    />
  );
};
