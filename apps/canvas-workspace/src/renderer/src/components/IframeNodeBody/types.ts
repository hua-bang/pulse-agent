import type { AgentContextDomReviewComment, AgentContextDomSelectionRef, CanvasNode } from '../../types';
import type { BrowserLoadState } from '../EmbeddedBrowser/types';

export type EditMode = 'url' | 'html' | 'ai';
export type LoadState = BrowserLoadState;

export interface IframeNodeBodyProps {
  node: CanvasNode;
  workspaceId?: string;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  isFullscreen?: boolean;
  isSelected?: boolean;
  isResizing?: boolean;
  onAddDomSelectionToChat?: (selection: AgentContextDomSelectionRef) => void;
  onSubmitDomReviewComments?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  readOnly?: boolean;
}
