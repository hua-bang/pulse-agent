import { lazy, Suspense } from 'react';
import type { SettingsSection } from '../../settings/Settings';
import { PulseRouterView } from '../../shell/router';

const ScheduledPage = lazy(() => import('./ScheduledPage').then((module) => ({ default: module.ScheduledPage })));
const ScheduledTaskChatPage = lazy(() => import('./ScheduledTaskChatPage').then((module) => ({ default: module.ScheduledTaskChatPage })));

interface Props {
  scheduledTaskId: string | null;
  onExitScheduledTask: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
}

export const ScheduledRouteViews = ({
  scheduledTaskId,
  onExitScheduledTask,
  onOpenAppSettings,
}: Props) => (
  <>
    <PulseRouterView name="scheduled">
      <Suspense fallback={null}>
        <ScheduledPage />
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
