import type { NavItem } from '../../../../../plugins/types';
import type { WorkspaceEntry, FolderEntry } from '../../../shared/workspaces';
import type { CanvasNode } from '../../../types';

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  workspaces: WorkspaceEntry[];
  folders: FolderEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string, folderId?: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onOpenSettings: (id: string) => void;
  /** Opens the global Settings drawer (gear button at the bottom of the sidebar). */
  onOpenAppSettings: () => void;
  onImport: () => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onMoveWorkspace: (workspaceId: string, folderId: string | undefined) => void;
  onReorderWorkspace: (
    workspaceId: string,
    beforeWorkspaceId: string | null,
    folderId: string | undefined,
  ) => void;
  onReorderFolder: (folderId: string, beforeFolderId: string | null) => void;
  activeNodes?: CanvasNode[];
  selectedNodeIds?: string[];
  onNodeFocus?: (nodeId: string) => void;
  onNodeDelete?: (nodeId: string) => void;
  onNodeRename?: (nodeId: string, title: string) => void;
  activeView: string;
  onEnterChat: () => void;
  onEnterNodes: () => void;
  onEnterGraph: () => void;
  onEnterSkills: () => void;
  onEnterScheduled: () => void;
  /** When false, the Nodes nav button is hidden (feature flag off). */
  nodesEnabled: boolean;
  /** When false, the Graph nav button is hidden (feature flag off). */
  graphEnabled: boolean;
  pluginNavItems: ReadonlyArray<NavItem>;
  onNavigate: (path: string) => void;
  onExitChat: () => void;

  enableSkills?: boolean;
  enableScheduled?: boolean;
}
