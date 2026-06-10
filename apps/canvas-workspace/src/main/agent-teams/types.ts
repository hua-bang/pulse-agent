import type { AgentRole } from 'pulse-coder-agent-teams/runtime';

export type CanvasAgentTeamPhase = 'briefing' | 'plan_review' | 'executing';

export interface CanvasAgentTeamPlanTeammate {
  name: string;
  agentType?: string;
}

export interface CanvasAgentTeamPlanTask {
  title: string;
  description: string;
  ownerName?: string;
  deps: string[];
  /** File or directory paths this task may create or modify. */
  scope?: string[];
}

export interface CanvasAgentTeamPlanDraft {
  summary: string;
  teammates: CanvasAgentTeamPlanTeammate[];
  tasks: CanvasAgentTeamPlanTask[];
  sourceAgentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasAgentTeamMetadata {
  workspaceId: string;
  frameNodeId?: string;
  agentNodeIds: Record<string, string>;
  cwd?: string;
  phase?: CanvasAgentTeamPhase;
  pendingPlan?: CanvasAgentTeamPlanDraft;
  approvedPlan?: CanvasAgentTeamPlanDraft;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasAgentTeamCreateInput {
  workspaceId: string;
  name: string;
  goal: string;
  cwd?: string;
  leadName?: string;
  leadAgentType?: string;
  teammateNames?: string[];
  teammateAgentType?: string;
  x?: number;
  y?: number;
}

export interface CanvasAgentTeamAddAgentInput {
  workspaceId: string;
  teamId: string;
  name: string;
  role: AgentRole;
  agentType?: string;
  cwd?: string;
}

export interface CanvasAgentTeamCreateTaskInput {
  workspaceId: string;
  teamId: string;
  title: string;
  description: string;
  ownerAgentId?: string;
  ownerName?: string;
  deps?: string[];
  depRefs?: string[];
  scope?: string[];
  dispatch?: boolean;
  /** Calling agent (from the CLI session env); task creation is lead-only. */
  sourceAgentId?: string;
}

export interface CanvasAgentTeamTaskActionInput {
  workspaceId: string;
  teamId: string;
  taskId?: string;
  sourceAgentId?: string;
}

export interface CanvasAgentTeamCompleteTaskInput extends CanvasAgentTeamTaskActionInput {
  summary: string;
}

export interface CanvasAgentTeamBlockTaskInput extends CanvasAgentTeamTaskActionInput {
  reason: string;
}

export interface CanvasAgentTeamRequestHumanInput extends CanvasAgentTeamTaskActionInput {
  prompt: string;
  reason?: string;
}

export interface CanvasAgentTeamPublishArtifactInput extends CanvasAgentTeamTaskActionInput {
  kind?: string;
  title: string;
  uri?: string;
  summary?: string;
}

export interface CanvasAgentTeamSnapshot {
  workspaceId: string;
  frameNodeId?: string;
  phase: CanvasAgentTeamPhase;
  pendingPlan?: CanvasAgentTeamPlanDraft;
  approvedPlan?: CanvasAgentTeamPlanDraft;
  runtime: import('pulse-coder-agent-teams/runtime').RuntimeSnapshot;
}

export type CanvasAgentTeamResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
