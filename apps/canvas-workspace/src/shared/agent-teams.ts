export type AgentTeamStatus =
  | 'planning'
  | 'waiting_approval'
  | 'running'
  | 'reviewing'
  | 'paused'
  | 'round_checkpoint'
  | 'completed'
  | 'failed';

export type AgentTeamAgentStatus =
  | 'idle'
  | 'running'
  | 'needs_input'
  | 'blocked'
  | 'done'
  | 'error'
  | 'stopped';

export type AgentTeamTaskStatus =
  | 'todo'
  | 'in_progress'
  | 'needs_input'
  | 'needs_review'
  | 'blocked'
  | 'done'
  | 'failed';

export interface AgentTeamRecord {
  id: string;
  name: string;
  goal: string;
  status: AgentTeamStatus;
  leadAgentId?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface AgentTeamAgentRecord {
  id: string;
  teamId: string;
  role: 'lead' | 'teammate';
  name: string;
  status: AgentTeamAgentStatus;
  cwd?: string;
  currentTaskId?: string;
  sessionRef?: {
    sessionId: string;
    provider: string;
    displayName?: string;
    metadata?: Record<string, unknown>;
  };
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface AgentTeamTaskRecord {
  id: string;
  teamId: string;
  title: string;
  description: string;
  status: AgentTeamTaskStatus;
  ownerAgentId?: string;
  deps: string[];
  result?: string;
  blockedReason?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface AgentTeamHumanGateRecord {
  id: string;
  teamId: string;
  taskId?: string;
  agentId?: string;
  reason: string;
  prompt: string;
  status: 'open' | 'answered' | 'cancelled';
  answer?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface AgentTeamArtifactRecord {
  id: string;
  teamId: string;
  taskId?: string;
  agentId?: string;
  kind: string;
  title: string;
  uri?: string;
  summary?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface AgentTeamEventRecord {
  id: string;
  teamId: string;
  type: string;
  timestamp: number;
  actor: string;
  payload: Record<string, unknown>;
}

export interface AgentTeamMessageRecord {
  id: string;
  teamId: string;
  from: string;
  to: string;
  type: string;
  content: string;
  taskId?: string;
  createdAt: number;
  readAt?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentTeamRuntimeSnapshot {
  team: AgentTeamRecord;
  agents: AgentTeamAgentRecord[];
  tasks: AgentTeamTaskRecord[];
  artifacts: AgentTeamArtifactRecord[];
  humanGates: AgentTeamHumanGateRecord[];
  events: AgentTeamEventRecord[];
  messages: AgentTeamMessageRecord[];
  checkpointRound?: number;
}

export type AgentTeamPhase = 'briefing' | 'plan_review' | 'starting' | 'executing';

export interface AgentTeamPlanTeammate {
  name: string;
  agentType?: string;
}

export interface AgentTeamPlanTask {
  title: string;
  description: string;
  ownerName?: string;
  deps: string[];
  /** File or directory paths this task may create or modify. */
  scope?: string[];
  /** Mechanical verification command, or 'manual'. */
  verify?: string;
}

export interface AgentTeamPlanDraft {
  summary: string;
  teammates: AgentTeamPlanTeammate[];
  tasks: AgentTeamPlanTask[];
  /** Team-level command proving the whole deliverable works together. */
  integrationVerify?: string;
  sourceAgentId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Liveness of an agent's PTY session as reported by the main process. */
export type AgentTeamSessionHealth = 'live' | 'queued' | 'dead' | 'missing';

export interface AgentTeamSnapshot {
  workspaceId: string;
  frameNodeId?: string;
  phase: AgentTeamPhase;
  pendingPlan?: AgentTeamPlanDraft;
  approvedPlan?: AgentTeamPlanDraft;
  runtime: AgentTeamRuntimeSnapshot;
  /** Per-agent session liveness, keyed by agent id. */
  sessions?: Record<string, AgentTeamSessionHealth>;
}
