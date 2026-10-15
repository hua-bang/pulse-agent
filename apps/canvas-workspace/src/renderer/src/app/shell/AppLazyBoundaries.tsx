import { lazy, Suspense } from 'react';
import type { WorkspaceEntry } from '../../shared/workspaces';

export const NodesPageLazy = lazy(() =>
  import('../../modules/workspace-nodes/nodes-page').then((module) => ({ default: module.NodesPage })),
);

export const NodeDetailPageLazy = lazy(() =>
  import('../../modules/workspace-nodes/detail-page').then((module) => ({ default: module.NodeDetailPage })),
);

const WorkspaceSettingsDrawer = lazy(() =>
  import('../../modules/settings/workspace').then((module) => ({ default: module.WorkspaceSettingsDrawer })),
);

interface DeferredSettingsProps {
  workspaceLoaded: boolean;
  workspaceId: string | null;
  workspaces: WorkspaceEntry[];
  onCloseWorkspace: () => void;
  onRenameWorkspace: (id: string, name: string) => void;
  onSetRootFolder: (id: string, rootFolder: string) => void;
}

export const DeferredSettings = ({
  workspaceLoaded,
  workspaceId,
  workspaces,
  onCloseWorkspace,
  onRenameWorkspace,
  onSetRootFolder,
}: DeferredSettingsProps) => (
  <>
    {workspaceLoaded && (
      <Suspense fallback={null}>
        <WorkspaceSettingsDrawer
          workspace={workspaceId ? workspaces.find((ws) => ws.id === workspaceId) ?? null : null}
          onClose={onCloseWorkspace}
          onRename={onRenameWorkspace}
          onSetRootFolder={onSetRootFolder}
        />
      </Suspense>
    )}
  </>
);
