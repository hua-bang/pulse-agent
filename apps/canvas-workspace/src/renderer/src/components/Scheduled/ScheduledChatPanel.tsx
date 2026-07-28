import { useEffect, useMemo, useState } from 'react';
import type { ScheduledTask } from '../../../../shared/scheduled';
import type { SettingsSection } from '../Settings';
import type { WorkspaceOption } from '../chat/types';
import { ChatPanelLazy as ChatPanel } from '../chat/lazy';
import { useScheduledChatStatus } from './useScheduledChatStatus';
import './index.css';

interface ScheduledChatPanelProps {
  taskId: string;
  revision: number;
  allWorkspaces: WorkspaceOption[];
  onClose: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
  onTurnComplete: () => void;
}

export const ScheduledChatPanel = ({
  taskId,
  revision,
  allWorkspaces,
  onClose,
  onOpenAppSettings,
  onTurnComplete,
}: ScheduledChatPanelProps) => {
  const [task, setTask] = useState<ScheduledTask>();
  const agentScope = useMemo(() => ({ kind: 'scheduled' as const, taskId }), [taskId]);
  const { banner, pendingLabel } = useScheduledChatStatus(task);

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

  return (
    <ChatPanel
      key={`${taskId}:${revision}`}
      agentScope={agentScope}
      allWorkspaces={allWorkspaces}
      banner={banner}
      pendingLabel={pendingLabel}
      onClose={onClose}
      onOpenAppSettings={onOpenAppSettings}
      onTurnComplete={onTurnComplete}
    />
  );
};
