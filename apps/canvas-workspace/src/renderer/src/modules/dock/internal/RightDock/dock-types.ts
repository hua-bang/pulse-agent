import type { CanvasNode } from '../../../../types';
import type { WorkspaceEntry } from '../../../../shared/workspaces';

export type * from '../../../../shared/dockTypes';

export interface RightDockProps {
  activeWorkspaceId: string;
  activeIdReady: boolean;
  chatTabEnabled: boolean;
  reserveSpace: boolean;
  capWidth: boolean;
  canvasTabEditingAllowed?: boolean;
  onCanvasNodesChange?: (canvasId: string, nodes: CanvasNode[]) => void;
  onCanvasSelectionChange?: (canvasId: string, selectedNodeIds: string[]) => void;
  pageMinAppWidth?: number;
  workspaces: WorkspaceEntry[];
  onOpenNodePage: (workspaceId: string, nodeId: string) => void;
  onActivateWorkspace?: (workspaceId: string) => void;
}
