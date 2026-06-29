import type { ReactNode } from 'react';
import type { AgentTeamStatus, CanvasNode } from '../../types';

export interface AgentNodeBodyProps {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
  rootFolder?: string;
  workspaceId?: string;
  workspaceName?: string;
  teamLeadBriefSlot?: ReactNode;
  agentTeamStatus?: AgentTeamStatus;
  onUpdate: (id: string, patch: Partial<CanvasNode>, addToHistory?: boolean) => void;
  readOnly?: boolean;
  terminalMode?: 'owner' | 'mirror';
  forceTeamWarmup?: boolean;
}

export type ViewMode = 'setup' | 'running' | 'restart';
