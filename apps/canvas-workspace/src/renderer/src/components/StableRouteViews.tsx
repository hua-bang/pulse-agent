import { lazy, Suspense } from 'react';
import type { WorkspaceEntry } from '../hooks/useWorkspaces';
import type { SettingsSection } from './Settings';
import { PulseRouterView } from './router';

const SkillsLibrary = lazy(() => import('./SkillsLibrary').then((module) => ({ default: module.SkillsLibrary })));
const ScheduledPage = lazy(() => import('./Scheduled/ScheduledPage').then((module) => ({ default: module.ScheduledPage })));
const ScheduledTaskChatPage = lazy(() => import('./Scheduled/ScheduledTaskChatPage').then((module) => ({ default: module.ScheduledTaskChatPage })));

interface Props {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  scheduledTaskId: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onOpenScheduledTask: (taskId: string) => void;
  onExitScheduledTask: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
}

export const StableRouteViews = ({
  activeWorkspaceId,
  workspaces,
  scheduledTaskId,
  onSelectWorkspace,
  onOpenScheduledTask,
  onExitScheduledTask,
  onOpenAppSettings,
}: Props) => (
  <>
    <PulseRouterView name="skills">
      <Suspense fallback={null}>
        <SkillsLibrary
          activeWorkspaceId={activeWorkspaceId}
          workspaces={workspaces}
          onSelectWorkspace={onSelectWorkspace}
        />
      </Suspense>
    </PulseRouterView>
    <PulseRouterView name="scheduled">
      <Suspense fallback={null}>
        <ScheduledPage onOpenTask={onOpenScheduledTask} />
      </Suspense>
    </PulseRouterView>
    <PulseRouterView name="scheduled-task">
      {scheduledTaskId && (
        <Suspense fallback={null}>
          <ScheduledTaskChatPage
            taskId={scheduledTaskId}
            onExit={onExitScheduledTask}
            onOpenAppSettings={onOpenAppSettings}
          />
        </Suspense>
      )}
    </PulseRouterView>
  </>
);
