import type { AgentContextDomReviewComment, AgentContextDomSelectionRef, CanvasNode } from '../../types';
import type { BrowserLoadState } from '../EmbeddedBrowser/types';

export type EditMode = 'url' | 'html' | 'ai';
export type LoadState = BrowserLoadState;

export interface IframeNodeBodyProps {
  node: CanvasNode;
  workspaceId?: string;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  isResizing?: boolean;
  onAddDomSelectionToChat?: (selection: AgentContextDomSelectionRef) => void;
  onSubmitDomReviewComments?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  // Read-only embeds can't persist the guest page title through onUpdate
  // (it's typically a noop there); this lets the host own persistence —
  // e.g. the reference drawer writes it back onto the URL reference entry.
  onPageTitleChange?: (title: string) => void;
  readOnly?: boolean;
}
