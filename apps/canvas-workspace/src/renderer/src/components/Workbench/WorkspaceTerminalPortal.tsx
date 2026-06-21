import { createPortal } from 'react-dom';
import { useRightDockTerminalHost } from '../RightDock';
import { WorkspaceTerminalDock } from '../WorkspaceTerminalDock';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { CanvasNode } from '../../types';

interface WorkspaceTerminalPortalProps {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  mountedWorkspaceIds: Set<string>;
  allNodes: Record<string, CanvasNode[]>;
  open: boolean;
  onClose: () => void;
}

export const WorkspaceTerminalPortal = ({
  activeWorkspaceId,
  workspaces,
  mountedWorkspaceIds,
  allNodes,
  open,
  onClose,
}: WorkspaceTerminalPortalProps) => {
  const terminalHost = useRightDockTerminalHost();
  if (!terminalHost) return null;

  return createPortal(
    workspaces.filter((ws) => mountedWorkspaceIds.has(ws.id)).map((ws) => (
      <div
        key={ws.id}
        className="right-dock__terminal-instance"
        style={ws.id !== activeWorkspaceId ? { display: 'none' } : undefined}
      >
        <WorkspaceTerminalDock
          workspaceId={ws.id}
          workspaceName={ws.name}
          rootFolder={ws.rootFolder}
          nodes={allNodes[ws.id] || []}
          open={ws.id === activeWorkspaceId && open}
          onClose={onClose}
          placement="pane"
        />
      </div>
    )),
    terminalHost,
  );
};
