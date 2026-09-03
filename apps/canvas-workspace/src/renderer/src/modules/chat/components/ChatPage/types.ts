import type { CanvasNode, WorkspaceOption } from '../../../../types';
import type { SettingsSection } from '../../../settings';
import type { ChatTarget } from '../../target';

export interface ChatPageProps {
  allWorkspaces: WorkspaceOption[];
  openScheduledTaskId?: string | null;
  initialTarget?: ChatTarget | null;
  getWorkspaceNodes?: (workspaceId: string) => CanvasNode[];
  getWorkspaceRootFolder?: (workspaceId: string) => string | undefined;
  onWorkspaceContextRequest?: (workspaceId: string) => void;
  onWorkspaceScopeChange?: (workspaceId: string | null) => void;
  onExit: () => void;
  onNodeFocus?: (workspaceId: string, nodeId: string) => void;
  onOpenAppSettings: (section: SettingsSection) => void;
}
