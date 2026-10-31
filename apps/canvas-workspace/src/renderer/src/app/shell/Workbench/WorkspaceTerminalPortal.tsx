import { lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useRightDockTerminalHost } from '../../../modules/dock';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import { GLOBAL_CHAT_STORE_ID } from '../../../../../shared/agent-chat';
import type { AgentContextTabRef, CanvasNode } from '../../../types';
import type { DockTerminalWorkspaceState } from '../../../modules/dock';

// The dock terminal pulls @xterm/xterm (+ addons). React.lazy keeps that out
// of the eagerly-parsed entry chunk (C2); the chunk loads on the first
// terminal tab. Terminal/agent node bodies load xterm via their own lazy
// boundary (DefaultCanvasNode, C1/C6) — Vite shares the chunk between them.
const WorkspaceTerminalDock = lazy(() =>
  import('../../../modules/dock/terminal').then((m) => ({ default: m.WorkspaceTerminalDock })),
);

interface WorkspaceTerminalPortalProps {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  mountedWorkspaceIds: Set<string>;
  allNodes: Record<string, CanvasNode[]>;
  /** Tabs of the active workspace's dock, for the terminal ⌘2 picker. */
  activeDockTabs: AgentContextTabRef[];
  terminalTabsByWorkspace: Record<string, DockTerminalWorkspaceState>;
  activeTerminalTabId?: string;
  open: boolean;
  onClose: (id?: string) => void;
  onAgentTypeChange: (id: string, agentType: string | undefined, workspaceId: string) => void;
}

export const WorkspaceTerminalPortal = ({
  activeWorkspaceId,
  workspaces,
  mountedWorkspaceIds,
  allNodes,
  activeDockTabs,
  terminalTabsByWorkspace,
  activeTerminalTabId,
  open,
  onClose,
  onAgentTypeChange,
}: WorkspaceTerminalPortalProps) => {
  const terminalHost = useRightDockTerminalHost();
  if (!terminalHost) return null;

  // Global has no workspace entry; its terminals start in the home folder.
  const scopes: Array<{ id: string; name?: string; rootFolder?: string }> = workspaces
    .filter((ws) => mountedWorkspaceIds.has(ws.id) || terminalTabsByWorkspace[ws.id]?.tabs.length);
  if (terminalTabsByWorkspace[GLOBAL_CHAT_STORE_ID]?.tabs.length) {
    scopes.push({ id: GLOBAL_CHAT_STORE_ID });
  }

  return createPortal(
    scopes.flatMap((ws) => {
      const terminalTabs = terminalTabsByWorkspace[ws.id]?.tabs ?? [];
      return terminalTabs.map((tab) => {
        const visible = ws.id === activeWorkspaceId && tab.id === activeTerminalTabId;
        return (
          <div
            key={`${ws.id}:${tab.id}`}
            className="right-dock__terminal-instance"
            style={visible ? undefined : { display: 'none' }}
          >
            <Suspense fallback={null}>
            <WorkspaceTerminalDock
              workspaceId={ws.id}
              terminalId={tab.id}
              terminalTitle={tab.title}
              workspaceName={ws.name}
              rootFolder={ws.rootFolder}
              nodes={allNodes[ws.id] || []}
              dockTabs={ws.id === activeWorkspaceId ? activeDockTabs : undefined}
              open={visible && open}
              onClose={() => onClose(tab.id)}
              onAgentTypeChange={(agentType) => onAgentTypeChange(tab.id, agentType, ws.id)}
              placement="pane"
            />
            </Suspense>
          </div>
        );
      });
    }),
    terminalHost,
  );
};
