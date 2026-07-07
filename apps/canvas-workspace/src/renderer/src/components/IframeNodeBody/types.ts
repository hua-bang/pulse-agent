import type { AgentContextDomReviewComment, AgentContextDomSelectionRef, CanvasNode } from '../../types';

export type EditMode = 'url' | 'html' | 'ai';
export type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

export interface IframeNodeBodyProps {
  node: CanvasNode;
  workspaceId?: string;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  isResizing?: boolean;
  onAddDomSelectionToChat?: (selection: AgentContextDomSelectionRef) => void;
  onSubmitDomReviewComments?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  readOnly?: boolean;
}

export interface WebviewTag extends HTMLElement {
  getWebContentsId(): number;
  reload(): void;
}
