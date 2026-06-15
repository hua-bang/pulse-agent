import type { AgentContextDomSelectionRef, CanvasNode } from '../../types';

export type EditMode = 'url' | 'html' | 'ai';
export type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

export interface IframeNodeBodyProps {
  node: CanvasNode;
  workspaceId?: string;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  isResizing?: boolean;
  onAddDomSelectionToChat?: (selection: AgentContextDomSelectionRef) => void;
  readOnly?: boolean;
}

export interface WebviewTag extends HTMLElement {
  getWebContentsId(): number;
  reload(): void;
}
