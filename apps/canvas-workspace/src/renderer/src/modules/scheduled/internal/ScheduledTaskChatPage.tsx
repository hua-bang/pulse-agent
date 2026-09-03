import { useCallback, useEffect, useState } from 'react';
import type { ScheduledTask } from '../../../../../shared/scheduled';
import { useI18n } from '../../../i18n';
import type { SettingsSection } from '../../settings';
import { useAppShell } from '../../../app/shell/AppShellProvider';
import { ChatPageBody } from '../../../modules/chat/embedded';
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
      key={task.id}
      agentScope={{ kind: 'scheduled', taskId: task.id }}
      initialPendingSessionId={null}
      pendingSessionId={null}
      pendingSessionIntentId={null}
      onSessionConsumed={() => undefined}
      onSelectSession={() => undefined}
      allWorkspaces={[]}
      onExit={onExit}
      railCollapsed
      onToggleRail={() => undefined}
      onOpenAppSettings={onOpenAppSettings}
      fixedChat={{ title: task.title }}
    />
  );
};
