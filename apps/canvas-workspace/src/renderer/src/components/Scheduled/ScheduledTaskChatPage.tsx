import { useCallback, useEffect, useState } from 'react';
import type { ScheduledTask } from '../../../../shared/scheduled';
import { useI18n } from '../../i18n';
import type { SettingsSection } from '../Settings';
import { useAppShell } from '../AppShellProvider';
import { ChatPageBody } from '../chat/ChatPageBody';
import './index.css';

interface Props {
  taskId: string;
  onExit: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
}

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
      fixedChat={{ title: task.title }}
    />
  );
};
