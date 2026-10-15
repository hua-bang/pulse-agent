import type { CanvasNode } from '../../../../../types';
import type { WorkspaceEntry } from '../../../../../shared/workspaces';

export type * from '../../../../../shared/dockTypes';

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
  readingLeftInset?: number;
  hostView?: string;
  /** Hide the dock and its strip but keep it mounted, so terminals and chats
   *  survive; for full pages that own the whole width. */
  hidden?: boolean;
  workspaces: WorkspaceEntry[];
  onOpenNodePage: (workspaceId: string, nodeId: string) => void;
  onActivateWorkspace?: (workspaceId: string) => boolean | void;
}
