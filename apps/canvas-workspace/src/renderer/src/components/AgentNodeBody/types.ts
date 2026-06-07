import type { ReactNode } from 'react';
import type { CanvasNode } from '../../types';

export interface AgentNodeBodyProps {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
  rootFolder?: string;
  workspaceId?: string;
  workspaceName?: string;
  teamLeadBriefSlot?: ReactNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  readOnly?: boolean;
  terminalMode?: 'owner' | 'mirror';
}

export type ViewMode = 'setup' | 'running' | 'restart';
