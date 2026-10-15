import type { NavItem } from '../../../../../plugins/types';
import type { WorkspaceEntry, FolderEntry } from '../../../shared/workspaces';
import type { CanvasNode } from '../../../types';
import type { McpAppEntrypointListing } from '../../../../../shared/mcp-apps';

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /** The rail shows a label beside each icon. */
  railExpanded: boolean;
  onToggleRail: () => void;
  workspaces: WorkspaceEntry[];
  folders: FolderEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string, folderId?: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onOpenSettings: (id: string) => void;
  /** Opens the global Settings page (gear at the bottom of the app rail). */
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
  onEnterHome: () => void;
  onEnterCanvas: () => void;
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
  /** Key of the global MCP App the main area shows, or null. */
  activeMcpAppKey?: string | null;
  onOpenMcpApp?: (listing: McpAppEntrypointListing) => void;

  enableSkills?: boolean;
  enableScheduled?: boolean;
}
