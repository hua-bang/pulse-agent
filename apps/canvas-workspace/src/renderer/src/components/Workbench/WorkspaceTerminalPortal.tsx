import { createPortal } from 'react-dom';
import { useRightDockTerminalHost } from '../RightDock';
import { WorkspaceTerminalDock } from '../WorkspaceTerminalDock';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { CanvasNode } from '../../types';
import type { DockTerminalWorkspaceState } from '../RightDock';

interface WorkspaceTerminalPortalProps {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  mountedWorkspaceIds: Set<string>;
  allNodes: Record<string, CanvasNode[]>;
  terminalTabsByWorkspace: Record<string, DockTerminalWorkspaceState>;
  activeTerminalTabId?: string;
  open: boolean;
  onClose: (id?: string) => void;
}

export const WorkspaceTerminalPortal = ({
  activeWorkspaceId,
  workspaces,
  mountedWorkspaceIds,
  allNodes,
  terminalTabsByWorkspace,
  activeTerminalTabId,
  open,
  onClose,
}: WorkspaceTerminalPortalProps) => {
  const terminalHost = useRightDockTerminalHost();
  if (!terminalHost) return null;

  return createPortal(
    workspaces.filter((ws) => mountedWorkspaceIds.has(ws.id)).flatMap((ws) => {
      const terminalTabs = terminalTabsByWorkspace[ws.id]?.tabs ?? [];
      return terminalTabs.map((tab) => {
        const visible = ws.id === activeWorkspaceId && tab.id === activeTerminalTabId;
        return (
          <div
            key={`${ws.id}:${tab.id}`}
            className="right-dock__terminal-instance"
            style={visible ? undefined : { display: 'none' }}
          >
            <WorkspaceTerminalDock
              workspaceId={ws.id}
              terminalId={tab.id}
              terminalTitle={tab.title}
              workspaceName={ws.name}
              rootFolder={ws.rootFolder}
              nodes={allNodes[ws.id] || []}
              open={visible && open}
              onClose={() => onClose(tab.id)}
              placement="pane"
            />
          </div>
        );
      });
    }),
    terminalHost,
  );
};
