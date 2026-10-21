import type {
  AgentContextTabRef,
  AgentRequestContext,
  AgentScope,
  CanvasNode,
  ChatImageAttachment,
  ChatRunInputMode,
  WorkspaceOption,
} from '../../../../types';

export interface SelectedContextChip {
  key: string;
  kind: 'node' | 'tag' | 'canvas' | 'app' | 'task' | 'skill';
  nodeType?: CanvasNode['type'];
  label: string;
  /** Page-owned context (the open app or skill) follows the page, not the user. */
  removable?: boolean;
}

export interface UseChatComposerInputOptions {
  allWorkspaces?: WorkspaceOption[];
  agentScope: AgentScope;
  nodes?: CanvasNode[];
  rootFolder?: string;
  knowledgeTags?: Array<{ id: string; name: string; workspaceIds?: string[] }>;
  dockTabs?: AgentContextTabRef[];
  collectStructuredContext?: boolean;
  onSubmit: (
    text: string,
    requestContext?: AgentRequestContext,
    attachments?: ChatImageAttachment[],
  ) => Promise<boolean>;
  onSubmitDuringRun?: (
    mode: ChatRunInputMode,
    text: string,
    requestContext?: AgentRequestContext,
  ) => Promise<boolean>;
  getRequestContext?: () => AgentRequestContext | undefined;
  isSubmitBlocked?: () => boolean;
  /** While a turn runs, Enter queues the draft like the Queue message button. */
  isRunning?: () => boolean;
}
