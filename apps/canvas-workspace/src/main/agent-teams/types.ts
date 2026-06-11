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
  /** Mechanical verification command, or 'manual' for unverifiable tasks. */
  verify?: string;
}

export interface CanvasAgentTeamPlanDraft {
  summary: string;
  teammates: CanvasAgentTeamPlanTeammate[];
  tasks: CanvasAgentTeamPlanTask[];
  /** Team-level command proving the whole deliverable works together. */
  integrationVerify?: string;
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
  /** Team-level integration verification command from the approved plan. */
  integrationVerify?: string;
  /** Finish was requested; auto-finalize once the integration round settles. */
  pendingFinalization?: boolean;
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
  verify?: string;
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

/**
 * Cancel (withdraw) a task so it settles as failed and releases its declared
 * file scope for replacement work. Lead/human only.
 */
export interface CanvasAgentTeamCancelTaskInput extends CanvasAgentTeamTaskActionInput {
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

/**
 * Liveness of an agent's PTY session as seen from the main process:
 * - `live`: PTY is running and can receive input now.
 * - `queued`: no PTY, but a launch prompt is queued — delivers on relaunch.
 * - `dead`: node exists, no PTY, nothing queued.
 * - `missing`: no session ref or the canvas node is gone.
 */
export type CanvasAgentSessionHealth = 'live' | 'queued' | 'dead' | 'missing';

export interface CanvasAgentTeamSnapshot {
  workspaceId: string;
  frameNodeId?: string;
  phase: CanvasAgentTeamPhase;
  pendingPlan?: CanvasAgentTeamPlanDraft;
  approvedPlan?: CanvasAgentTeamPlanDraft;
  runtime: import('pulse-coder-agent-teams/runtime').RuntimeSnapshot;
  /** Per-agent session liveness, keyed by agent id. */
  sessions?: Record<string, CanvasAgentSessionHealth>;
}

export interface CanvasAgentTeamSummary {
  teamId: string;
  name: string;
  status: string;
  phase: CanvasAgentTeamPhase;
  taskCounts: Record<string, number>;
  agentCount: number;
}

export type CanvasAgentTeamResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
