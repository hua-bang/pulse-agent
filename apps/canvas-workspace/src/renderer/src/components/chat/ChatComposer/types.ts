import type {
  AgentContextTabRef,
  AgentRequestContext,
  AgentScope,
  CanvasNode,
  ChatImageAttachment,
  ChatRunInputMode,
  WorkspaceOption,
} from '../../../types';

export interface SelectedContextChip {
  key: string;
  kind: 'node' | 'tag' | 'canvas';
  nodeType?: CanvasNode['type'];
  label: string;
}

export interface UseChatComposerInputOptions {
  allWorkspaces?: WorkspaceOption[];
  agentScope: AgentScope;
  nodes?: CanvasNode[];
  rootFolder?: string;
  knowledgeNodes?: Array<{ id: string; title: string; type: CanvasNode['type']; workspaceId?: string }>;
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
}
