import { lazy, Suspense } from 'react';
import type { WorkspaceEntry } from '../../../hooks/useWorkspaces';
import { PulseRouterView } from '../../../app/shell/router';
import { SkillsRouteLoading } from './SkillsLibraryLoading';
import './index.css';

const SkillsLibrary = lazy(() => import('.').then((module) => ({ default: module.SkillsLibrary })));

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
