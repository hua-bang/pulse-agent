import { lazy, Suspense } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import { PulseRouterView } from '../router';
import { SkillsRouteLoading } from '../../../modules/skills/loading';

const SkillsLibrary = lazy(() => import('../../../modules/skills/library').then((module) => ({ default: module.SkillsLibrary })));

interface Props {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  onSelectWorkspace: (workspaceId: string) => void;
  onNavigatePlugins: () => void;
}

export const SkillsRouteView = ({
  activeWorkspaceId,
  workspaces,
  onSelectWorkspace,
  onNavigatePlugins,
}: Props) => (
  <PulseRouterView name="skills">
    <Suspense fallback={<SkillsRouteLoading />}>
      <SkillsLibrary
        activeWorkspaceId={activeWorkspaceId}
        workspaces={workspaces}
        onSelectWorkspace={onSelectWorkspace}
        onNavigatePlugins={onNavigatePlugins}
      />
    </Suspense>
  </PulseRouterView>
);
