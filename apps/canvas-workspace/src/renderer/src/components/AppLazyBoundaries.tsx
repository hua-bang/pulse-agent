import { lazy, Suspense } from 'react';
import type { SettingsSection } from './Settings';
import type { WorkspaceEntry } from '../hooks/useWorkspaces';

export const NodesPageLazy = lazy(() =>
  import('./WorkspaceNodes/NodesPage').then((module) => ({ default: module.NodesPage })),
);

export const NodeDetailPageLazy = lazy(() =>
  import('./WorkspaceNodes/NodeDetailPage').then((module) => ({ default: module.NodeDetailPage })),
);

const Settings = lazy(() =>
  import('./Settings').then((module) => ({ default: module.Settings })),
);

const WorkspaceSettingsDrawer = lazy(() =>
  import('./WorkspaceSettings').then((module) => ({ default: module.WorkspaceSettingsDrawer })),
);

interface DeferredSettingsProps {
  appLoaded: boolean;
  appSection: SettingsSection | null;
  workspaceLoaded: boolean;
  workspaceId: string | null;
  workspaces: WorkspaceEntry[];
  onCloseApp: () => void;
  onCloseWorkspace: () => void;
  onRenameWorkspace: (id: string, name: string) => void;
  onSetRootFolder: (id: string, rootFolder: string) => void;
}

export const DeferredSettings = ({
  appLoaded,
  appSection,
  workspaceLoaded,
  workspaceId,
  workspaces,
  onCloseApp,
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
    {appLoaded && (
      <Suspense fallback={null}>
        <Settings open={appSection !== null} initialSection={appSection ?? 'models'} onClose={onCloseApp} />
      </Suspense>
    )}
  </>
);
