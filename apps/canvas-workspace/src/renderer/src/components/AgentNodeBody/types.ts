import type { CanvasNode } from '../../types';

export interface AgentNodeBodyProps {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
  rootFolder?: string;
  workspaceId?: string;
  workspaceName?: string;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  readOnly?: boolean;
}

export type ViewMode = 'setup' | 'running' | 'restart';
