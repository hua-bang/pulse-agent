import type { CanvasNode, WorkspaceOption } from '../../../../types';
import type { SettingsSection } from '../../../settings';
import type { ChatTarget } from '../../target';
import type { UseChatComposerInputOptions } from '../ChatComposer/types';

export interface ChatPageProps {
  allWorkspaces: WorkspaceOption[];
  openScheduledTaskId?: string | null;
  /** Bumped to show the session list, e.g. from the launcher's "View all". */
  sessionListRequest?: number;
  initialTarget?: ChatTarget | null;
  getWorkspaceNodes?: (workspaceId: string) => CanvasNode[];
  /** Cross-workspace @ candidates, offered while the page is on the global scope. */
  knowledgeNodes?: UseChatComposerInputOptions['knowledgeNodes'];
  knowledgeTags?: UseChatComposerInputOptions['knowledgeTags'];
  getWorkspaceRootFolder?: (workspaceId: string) => string | undefined;
  onWorkspaceContextRequest?: (workspaceId: string) => void;
  onWorkspaceScopeChange?: (workspaceId: string | null) => void;
  onExit: () => void;
  onNodeFocus?: (workspaceId: string, nodeId: string) => void;
  onOpenAppSettings: (section: SettingsSection) => void;
}
