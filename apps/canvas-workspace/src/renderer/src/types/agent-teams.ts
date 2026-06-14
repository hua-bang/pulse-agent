import type {
  AgentTeamRuntimeSnapshot,
  AgentTeamSnapshot,
} from '../../../shared/agent-teams';

export type * from '../../../shared/agent-teams';

export interface AgentTeamsApi {
  create: (input: {
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
  }) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  list: (workspaceId: string) => Promise<{ ok: boolean; teams?: AgentTeamSnapshot[]; error?: string }>;
  snapshot: (workspaceId: string, teamId: string) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  addAgent: (input: {
    workspaceId: string;
    teamId: string;
    name: string;
    role: 'lead' | 'teammate';
    agentType?: string;
    cwd?: string;
  }) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  briefLead: (
    workspaceId: string,
    teamId: string,
    content: string,
  ) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  confirmPlan: (
    workspaceId: string,
    teamId: string,
  ) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  updatePlanTeammate: (
    workspaceId: string,
    teamId: string,
    teammateName: string,
    agentType: string,
  ) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  createTask: (input: {
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
  }) => Promise<{ ok: boolean; runtime?: AgentTeamRuntimeSnapshot; error?: string }>;
  advanceRound: (
    workspaceId: string,
    teamId: string,
  ) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  finalizeFromCheckpoint: (
    workspaceId: string,
    teamId: string,
  ) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  updateTask: (
    workspaceId: string,
    teamId: string,
    taskId: string,
    title?: string,
    description?: string,
  ) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  dispatch: (workspaceId: string, teamId: string) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  pause: (workspaceId: string, teamId: string) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  resume: (workspaceId: string, teamId: string) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  prepareAgentAutoResume: (
    workspaceId: string,
    teamId: string,
    agentId: string,
  ) => Promise<{ ok: boolean; canResume?: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  delete: (
    workspaceId: string,
    teamId: string,
  ) => Promise<{ ok: boolean; deletedNodeIds?: string[]; error?: string }>;
  completeTask: (
    workspaceId: string,
    teamId: string,
    taskId: string,
    result?: string,
  ) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  openGate: (input: {
    workspaceId: string;
    teamId: string;
    agentId?: string;
    taskId?: string;
    reason: string;
    prompt: string;
  }) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  answerGate: (workspaceId: string, gateId: string, answer: string) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  interruptAgent: (input: {
    workspaceId: string;
    teamId: string;
    agentId: string;
    mode: 'soft' | 'ctrl-c' | 'abort';
    reason?: string;
  }) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
  sendInput: (
    workspaceId: string,
    teamId: string,
    agentId: string,
    content: string,
  ) => Promise<{ ok: boolean; snapshot?: AgentTeamSnapshot; error?: string }>;
}
