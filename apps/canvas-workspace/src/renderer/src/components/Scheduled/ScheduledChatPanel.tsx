import { useCallback, useEffect, useMemo, useState } from 'react';
import { SpinnerGap, Stop, WarningCircle } from '@phosphor-icons/react';
import type { ScheduledTask } from '../../../../shared/scheduled';
import type { SettingsSection } from '../Settings';
import type { WorkspaceOption } from '../chat/types';
import { ChatPanelLazy as ChatPanel } from '../chat/lazy';
import { useI18n } from '../../i18n';
import { Button } from '../ui';
import { formatElapsed, runProgressLabel } from './formatters';
import { useElapsedMs, useScheduledRunProgress } from './useScheduledRunProgress';
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
  const { t } = useI18n();
  const [task, setTask] = useState<ScheduledTask>();
  const agentScope = useMemo(() => ({ kind: 'scheduled' as const, taskId }), [taskId]);
  const running = task?.status === 'running';
  const progress = useScheduledRunProgress(taskId);
  // Time the run, not the panel: a panel opened mid-run must show how long the
  // RUN has been going, which is why startedAt comes from the main-process
  // snapshot rather than from mount time.
  const elapsedMs = useElapsedMs(running ? progress?.startedAt : undefined);

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

  const stopRun = useCallback(() => {
    // No error surface on purpose: the only way to miss the run is for it to
    // have just finished, and then the banner is already gone.
    void window.canvasWorkspace.scheduled.cancelRun(taskId);
  }, [taskId]);

  const progressLabel = runProgressLabel(progress, t);
  const detail = [
    progressLabel,
    elapsedMs === undefined ? undefined : t('scheduled.elapsed', { time: formatElapsed(elapsedMs) }),
  ].filter(Boolean).join(' · ');

  const banner = running ? (
    <div className="scheduled-chat-status" role="status">
      <SpinnerGap className="scheduled-spin" size={15} />
      <span>
        <strong>{t('scheduled.running')}</strong>
        <small>{detail}</small>
      </span>
      <Button
        size="xs"
        aria-label={t('scheduled.stopRun')}
        title={t('scheduled.stopRun')}
        disabled={progress?.cancelRequested === true}
        onClick={stopRun}
      >
        <Stop size={12} />
        {t('scheduled.stopRun')}
      </Button>
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
      key={`${taskId}:${revision}`}
      agentScope={agentScope}
      allWorkspaces={allWorkspaces}
      banner={banner}
      pendingLabel={running ? progressLabel : undefined}
      onClose={onClose}
      onOpenAppSettings={onOpenAppSettings}
      onTurnComplete={onTurnComplete}
    />
  );
};
