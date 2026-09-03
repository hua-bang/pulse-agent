import { lazy, Suspense } from 'react';
import type { AgentScope } from '../../../types';
import type { SettingsSection } from '../../settings';
import { PulseRouterView } from '../../../app/shell/router';

const ScheduledPage = lazy(() => import('./ScheduledPage').then((module) => ({ default: module.ScheduledPage })));
const ScheduledTaskChatPage = lazy(() => import('./ScheduledTaskChatPage').then((module) => ({ default: module.ScheduledTaskChatPage })));

interface Props {
  scheduledTaskId: string | null;
  onExitScheduledTask: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
  onOpenSessionInScope: (scope: AgentScope, sessionId: string, scopeLabel: string) => void | Promise<void>;
}

export const ScheduledRouteViews = ({
  scheduledTaskId,
  onExitScheduledTask,
  onOpenAppSettings,
  onOpenSessionInScope,
}: Props) => (
  <>
    <PulseRouterView name="scheduled">
      <Suspense fallback={null}>
        <ScheduledPage onOpenSessionInScope={onOpenSessionInScope} />
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
