import { lazy, Suspense } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { PulseRouterView } from '../router';

const SkillsLibrary = lazy(() => import('.').then((module) => ({ default: module.SkillsLibrary })));

interface Props {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  onSelectWorkspace: (workspaceId: string) => void;
}

export const SkillsRouteView = ({
  activeWorkspaceId,
  workspaces,
  onSelectWorkspace,
}: Props) => (
  <PulseRouterView name="skills">
    <Suspense fallback={null}>
      <SkillsLibrary
        activeWorkspaceId={activeWorkspaceId}
        workspaces={workspaces}
        onSelectWorkspace={onSelectWorkspace}
      />
    </Suspense>
  </PulseRouterView>
);
