import { lazy, Suspense } from 'react';
import { preloadableLazy } from '../../../shared/preloadableLazy';
import type { SettingsSection } from '../../../modules/settings';
import type { ScheduledTask } from '../../../types';
import { PulseRouterView } from '../router';

const ScheduledPage = preloadableLazy(() => import('../../../modules/scheduled/page').then((module) => ({ default: module.ScheduledPage })));
const ScheduledTaskChatPage = lazy(() => import('../../../modules/scheduled/task-page').then((module) => ({ default: module.ScheduledTaskChatPage })));

export const preloadScheduledPage = ScheduledPage.preload;

interface Props {
  scheduledTaskId: string | null;
  onExitScheduledTask: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
  onAskAiAboutTask: (task: ScheduledTask) => void;
}

export const ScheduledRouteViews = ({
  scheduledTaskId,
  onExitScheduledTask,
  onOpenAppSettings,
  onAskAiAboutTask,
}: Props) => (
  <>
    <PulseRouterView name="scheduled">
      <Suspense fallback={null}>
        <ScheduledPage onAskAi={onAskAiAboutTask} />
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
