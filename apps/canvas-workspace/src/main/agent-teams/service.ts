import { randomUUID } from 'crypto';
import {
  TeamRuntime,
  type AgentRole,
  type ArtifactKind,
  type RuntimeSnapshot,
  type TeamAgentRecord,
  type TeamTaskRecord,
} from 'pulse-coder-agent-teams/runtime';
import { CanvasAgentSessionAdapter } from './canvas-agent-session-adapter';
import {
  createAgentTeamCanvasNodes,
  createTeamAgentNode,
  ensureAgentTeamCanvasLayout,
  removeAgentTeamCanvasNodes,
  stopAgentTeamCanvasNodes,
} from './canvas-nodes';
import { CanvasAgentTeamStore } from './store';
import { broadcastCanvasUpdate } from '../canvas/broadcast';
import type {
  CanvasAgentTeamAddAgentInput,
  CanvasAgentTeamBlockTaskInput,
  CanvasAgentTeamCompleteTaskInput,
  CanvasAgentTeamCreateInput,
  CanvasAgentTeamCreateTaskInput,
  CanvasAgentTeamMetadata,
  CanvasAgentTeamPhase,
  CanvasAgentTeamPlanDraft,
  CanvasAgentTeamPlanTask,
  CanvasAgentTeamPlanTeammate,
  CanvasAgentTeamPublishArtifactInput,
  CanvasAgentTeamRequestHumanInput,
  CanvasAgentTeamSnapshot,
} from './types';

interface RuntimeBundle {
  store: CanvasAgentTeamStore;
  runtime: TeamRuntime;
}

const DEFAULT_LEAD_AGENT = 'codex';
const DEFAULT_TEAMMATE_AGENT = 'codex';
const MAX_AGENT_OUTPUT_BUFFER = 16_000;
const MAX_PLAN_TEAMMATES = 6;
const MAX_PLAN_TASKS = 20;
const ARTIFACT_KINDS = new Set<ArtifactKind>([
  'diff',
  'test_log',
  'note',
  'screenshot',
  'file',
  'summary',
  'other',
]);
const LEGACY_OUTPUT_BLOCK_REASON = 'Blocked by agent output marker.';
const AGENT_TEAM_MARKER_RE =
  /^\s*\[agent-team:(?<kind>plan|human-input-needed|artifact)(?:\s+taskId="(?<taskId>[^"]+)")?(?:\s+kind="(?<artifactKind>[^"]+)")?(?:\s+title="(?<artifactTitle>[^"]+)")?\]\s*(?<text>.*)\s*$/;

type AgentOutputMarkerKind = 'plan' | 'human-input-needed' | 'artifact';

interface AgentOutputMarker {
  kind: AgentOutputMarkerKind;
  taskId?: string;
  artifactKind?: string;
  artifactTitle?: string;
  text: string;
}

interface AgentNodeMatch {
  teamId: string;
  agent: TeamAgentRecord;
}

interface ResolvedPlanTask {
  id: string;
  task: CanvasAgentTeamPlanTask;
  depIds: string[];
}

const stripAnsi = (value: string): string =>
  value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');

const parseAgentOutputMarker = (line: string): AgentOutputMarker | null => {
  const match = AGENT_TEAM_MARKER_RE.exec(stripAnsi(line).trim());
  if (!match?.groups) return null;
  const text = match.groups.text.trim();
  if (/^<[^>]+>$/.test(text)) return null;
  if (
    match.groups.kind === 'human-input-needed'
    && /^agent requested human input\.?$/i.test(text)
  ) return null;
  return {
    kind: match.groups.kind as AgentOutputMarkerKind,
    taskId: match.groups.taskId,
    artifactKind: match.groups.artifactKind,
    artifactTitle: match.groups.artifactTitle,
    text,
  };
};

const normalizeArtifactKind = (value: string | undefined): ArtifactKind => {
  if (!value) return 'other';
  return ARTIFACT_KINDS.has(value as ArtifactKind) ? value as ArtifactKind : 'other';
};

const gateAudienceMetadataForAgent = (agent: TeamAgentRecord | undefined): Record<string, unknown> | undefined =>
  agent && agent.role !== 'lead' ? { audience: 'lead' } : undefined;

const humanInputReasonForAgent = (
  agent: TeamAgentRecord | undefined,
  explicitReason: string | undefined,
): string =>
  explicitReason || (agent && agent.role !== 'lead' ? 'Teammate requested Team Lead input' : 'Agent requested human input');

const asPlainObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const cleanString = (value: unknown, fallback = ''): string => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
};

const normalizePlanTeammates = (value: unknown): CanvasAgentTeamPlanTeammate[] => {
  const raw = Array.isArray(value) ? value : [];
  const teammates = raw
    .map((item): CanvasAgentTeamPlanTeammate | null => {
      if (typeof item === 'string') {
        const name = cleanString(item);
        return name ? { name, agentType: DEFAULT_TEAMMATE_AGENT } : null;
      }
      const obj = asPlainObject(item);
      const name = cleanString(obj.name);
      if (!name) return null;
      return {
        name,
        agentType: cleanString(obj.agentType, DEFAULT_TEAMMATE_AGENT),
      };
    })
    .filter((item): item is CanvasAgentTeamPlanTeammate => !!item)
    .slice(0, MAX_PLAN_TEAMMATES);

  return teammates.length > 0 ? teammates : [{ name: 'Codex Exec', agentType: DEFAULT_TEAMMATE_AGENT }];
};

const normalizePlanTasks = (value: unknown, fallbackSummary: string): CanvasAgentTeamPlanTask[] => {
  const raw = Array.isArray(value) ? value : [];
  const tasks = raw
    .map((item): CanvasAgentTeamPlanTask | null => {
      const obj = asPlainObject(item);
      const title = cleanString(obj.title);
      if (!title) return null;
      return {
        title,
        description: cleanString(obj.description, title),
        ownerName: cleanString(obj.ownerName) || undefined,
        deps: Array.isArray(obj.deps)
          ? obj.deps.map((dep) => cleanString(dep)).filter(Boolean)
          : [],
      };
    })
    .filter((item): item is CanvasAgentTeamPlanTask => !!item)
    .slice(0, MAX_PLAN_TASKS);

  if (tasks.length > 0) return tasks;
  return [{
    title: 'Execute approved plan',
    description: fallbackSummary || 'Carry out the plan approved by the user.',
    ownerName: 'Codex Exec',
    deps: [],
  }];
};

const parsePlanDraft = (text: string, sourceAgentId: string, now: number): CanvasAgentTeamPlanDraft | null => {
  const trimmed = text.trim();
  if (!trimmed || /^<[^>]+>$/.test(trimmed)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const obj = asPlainObject(parsed);
  const summary = cleanString(obj.summary, 'Leader proposed a team execution plan.');
  return {
    summary,
    teammates: normalizePlanTeammates(obj.teammates),
    tasks: normalizePlanTasks(obj.tasks, summary),
    sourceAgentId,
    createdAt: now,
    updatedAt: now,
  };
};

const planDraftFromUnknown = (value: unknown, sourceAgentId: string, now: number): CanvasAgentTeamPlanDraft => {
  if (typeof value === 'string') {
    const parsed = parsePlanDraft(value, sourceAgentId, now);
    if (!parsed) throw new Error('Plan must be valid JSON');
    return parsed;
  }

  const obj = asPlainObject(value);
  if (Object.keys(obj).length === 0) {
    throw new Error('Plan must be a JSON object');
  }
  const summary = cleanString(obj.summary, 'Leader proposed a team execution plan.');
  return {
    summary,
    teammates: normalizePlanTeammates(obj.teammates),
    tasks: normalizePlanTasks(obj.tasks, summary),
    sourceAgentId,
    createdAt: now,
    updatedAt: now,
  };
};

const planTaskKey = (title: string): string => title.trim().toLowerCase();

const resolvePlanTaskGraph = (tasks: CanvasAgentTeamPlanTask[]): ResolvedPlanTask[] => {
  const taskByTitle = new Map<string, { task: CanvasAgentTeamPlanTask; id: string }>();

  for (const task of tasks) {
    const key = planTaskKey(task.title);
    if (taskByTitle.has(key)) {
      throw new Error(`Duplicate task title in plan: ${task.title}`);
    }
    taskByTitle.set(key, { task, id: randomUUID() });
  }

  const resolved = tasks.map((task): ResolvedPlanTask => {
    const current = taskByTitle.get(planTaskKey(task.title));
    if (!current) throw new Error(`Task not found in plan: ${task.title}`);

    const depIds = Array.from(new Set((task.deps ?? []).map((depTitle) => {
      const depKey = planTaskKey(depTitle);
      const dep = taskByTitle.get(depKey);
      if (!dep) {
        throw new Error(`Unknown task dependency "${depTitle}" for task "${task.title}"`);
      }
      return dep.id;
    })));

    return { id: current.id, task, depIds };
  });

  assertResolvedPlanTaskGraphAcyclic(resolved);

  return resolved;
};

const assertResolvedPlanTaskGraphAcyclic = (tasks: ResolvedPlanTask[]): void => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const label = (id: string): string => {
    const task = byId.get(id);
    return task ? `${task.task.title} (${id})` : id;
  };

  const visit = (id: string): string[] | null => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    if (visited.has(id)) return null;

    const task = byId.get(id);
    if (!task) return null;

    visiting.add(id);
    stack.push(id);
    for (const depId of task.depIds) {
      const cycle = visit(depId);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const task of tasks) {
    const cycle = visit(task.id);
    if (cycle) {
      throw new Error(`Task dependency cycle detected: ${cycle.map(label).join(' -> ')}`);
    }
  }
};

const inferPhase = (
  metadata: CanvasAgentTeamMetadata | undefined,
  snapshot: RuntimeSnapshot,
): CanvasAgentTeamPhase => {
  if (metadata?.phase) return metadata.phase;
  if (metadata?.pendingPlan) return 'plan_review';
  if (snapshot.agents.some((agent) => agent.role === 'teammate') || snapshot.tasks.length > 0) {
    return 'executing';
  }
  return snapshot.team.status === 'waiting_approval' ? 'plan_review' : 'briefing';
};

const formatLeaderBriefingPrompt = (teamName: string, goal: string, content: string): string => [
  `You are the Team Leader for "${teamName}" in Pulse Canvas.`,
  '',
  `Current team goal: ${goal || 'Clarify the goal with the user.'}`,
  '',
  'Your only job in this phase is to clarify requirements and draft a Pulse Canvas Agent Team plan.',
  'Do not implement the task yourself.',
  'Do not spawn teammates yourself; Pulse Canvas will create teammate nodes only after the user approves your plan.',
  'If there is already a pending plan and the user asks for changes, revise and resubmit the plan. Do not create execution tasks during plan review.',
  '',
  'When the plan is ready for user approval, submit it through the Pulse Canvas CLI instead of writing a terminal marker.',
  'Prefer --plan-json so you do not need to edit a temporary file. Use this JSON shape:',
  '{"summary":"short plan summary","teammates":[{"name":"Backend Codex","agentType":"codex"},{"name":"Frontend Codex","agentType":"codex"},{"name":"QA Codex","agentType":"codex"}],"tasks":[{"title":"Define API contract","description":"Concrete instructions and expected output.","ownerName":"Backend Codex","deps":[]},{"title":"Implement frontend integration","description":"Concrete instructions and expected output.","ownerName":"Frontend Codex","deps":["Define API contract"]},{"title":"QA integration and fixes","description":"Verify the completed backend/frontend flow and report or fix issues.","ownerName":"QA Codex","deps":["Define API contract","Implement frontend integration"]}]}',
  '',
  'Every task object MUST include "deps": [] or a list of exact task titles from the same plan.',
  'Use deps to encode the real execution order. Do not rely on wording like "after" or "then" in descriptions.',
  'Downstream tasks such as frontend integration, QA, testing, review, documentation, release, validation, and final summary MUST depend on the implementation or contract tasks they need.',
  'Make each task narrow and non-overlapping. A task description MUST state the expected deliverable and its scope boundary.',
  'Survey, analysis, contract, architecture, and planning tasks should produce findings or a contract artifact only; they must not also implement runtime, host app, child apps, QA, or documentation unless that is the entire assigned task.',
  'Implementation tasks should not include QA/final summary work. QA/documentation/final summary tasks should be separate downstream tasks.',
  '',
  'Run:',
  'pulse-canvas team propose-plan --plan-json \'<json>\'',
  '',
  'If the JSON is too large or hard to quote, write a temporary file and run:',
  'pulse-canvas team propose-plan --plan-file <path-to-json>',
  '',
  'The CLI can read PULSE_CANVAS_WORKSPACE_ID, PULSE_CANVAS_TEAM_ID, PULSE_CANVAS_TEAM_AGENT_ID, PULSE_CANVAS_NODE_ID, and PULSE_CANVAS_TEAM_ROLE from this session environment.',
  '',
  `User message:\n${content}`,
].join('\n');

const formatLeadExecutionPrompt = (teamName: string, goal: string, content: string): string => [
  `Human follow-up for "${teamName}" in Pulse Canvas.`,
  '',
  `Team goal: ${goal || 'Coordinate the team.'}`,
  '',
  'You are the Team Leader during execution.',
  'First decide whether the human follow-up modifies existing work or creates genuinely new work.',
  'If it changes work that is already todo, in progress, needs input, or needs review, do not create a duplicate task. Send the change to the responsible teammate instead:',
  'pulse-canvas team send --to "Teammate name" --message "Revise the current task: ..."',
  'If a teammate already produced enough work to satisfy later tasks, close only the covered downstream tasks that are not actively running:',
  'pulse-canvas team complete-task --task "<covered downstream task id or title>" --summary "<why this was already satisfied>"',
  'If a covered downstream task is actively running, send guidance to that teammate instead of marking it complete.',
  'Use create-task only for new work not covered by any existing task:',
  'pulse-canvas team create-task --title "Task title" --description "Concrete instructions" --owner "Teammate name" --dispatch',
  '',
  'Use pulse-canvas team send --to "Teammate name" --message "..." to share context with a teammate.',
  'Use pulse-canvas team propose-plan only when the change needs a new human-approved plan.',
  'Do not use Claude/Codex subagents for teammate work; Pulse Canvas owns teammate nodes and dispatch.',
  'Handle this follow-up once. Do not run sleep, watch, tail, polling loops, or repeated status checks. Pulse Canvas will wake you again when another decision is required.',
  '',
  `Human message:\n${content}`,
].join('\n');

export class CanvasAgentTeamsService {
  private readonly runtimes = new Map<string, RuntimeBundle>();
  private readonly outputBuffers = new Map<string, string>();

  async createTeam(input: CanvasAgentTeamCreateInput): Promise<CanvasAgentTeamSnapshot> {
    const { runtime, store } = this.getBundle(input.workspaceId);
    const teamId = randomUUID();
    const leadAgentId = randomUUID();

    await runtime.createTeam({
      id: teamId,
      name: input.name,
      goal: input.goal,
      metadata: { workspaceId: input.workspaceId },
    });

    const createdNodes = await createAgentTeamCanvasNodes({
      workspaceId: input.workspaceId,
      teamId,
      name: input.name,
      goal: input.goal,
      cwd: input.cwd,
      lead: {
        agentId: leadAgentId,
        name: input.leadName || 'Team Lead',
        agentType: input.leadAgentType || DEFAULT_LEAD_AGENT,
      },
      teammates: [],
      x: input.x,
      y: input.y,
    });

    const now = Date.now();
    const metadata: CanvasAgentTeamMetadata = {
      workspaceId: input.workspaceId,
      frameNodeId: createdNodes.frameNodeId,
      agentNodeIds: createdNodes.agentNodeIds,
      phase: 'briefing',
      createdAt: now,
      updatedAt: now,
    };
    await store.saveTeamMetadata(teamId, metadata);

    await runtime.addAgent({
      id: leadAgentId,
      teamId,
      role: 'lead',
      name: input.leadName || 'Team Lead',
      sessionRef: {
        sessionId: createdNodes.agentNodeIds[leadAgentId],
        provider: 'pulse-canvas-agent-node',
        displayName: input.leadName || 'Team Lead',
        metadata: { workspaceId: input.workspaceId, nodeId: createdNodes.agentNodeIds[leadAgentId] },
      },
      metadata: { canvasNodeId: createdNodes.agentNodeIds[leadAgentId] },
    });

    return this.snapshot(input.workspaceId, teamId);
  }

  async briefLead(workspaceId: string, teamId: string, content: string): Promise<CanvasAgentTeamSnapshot> {
    const trimmed = content.trim();
    if (!trimmed) throw new Error('Leader briefing is empty');

    const { runtime, store } = this.getBundle(workspaceId);
    const snapshot = await runtime.snapshot(teamId);
    const lead = snapshot.agents.find((agent) => agent.role === 'lead');
    if (!lead) throw new Error(`Team lead not found for team ${teamId}`);

    await runtime.sendToAgent(
      lead.id,
      formatLeaderBriefingPrompt(snapshot.team.name, snapshot.team.goal, trimmed),
    );
    lead.status = 'running';
    lead.updatedAt = Date.now();
    await store.saveAgent(lead);

    const metadata = await this.requireMetadata(store, teamId);
    if (metadata.phase !== 'plan_review' && metadata.phase !== 'executing') {
      metadata.phase = 'briefing';
      metadata.updatedAt = Date.now();
      await store.saveTeamMetadata(teamId, metadata);
    }

    return this.snapshot(workspaceId, teamId);
  }

  async proposePlan(
    workspaceId: string,
    teamId: string,
    input: { sourceAgentId?: string; plan: unknown },
  ): Promise<CanvasAgentTeamSnapshot> {
    const { runtime, store } = this.getBundle(workspaceId);
    const runtimeSnapshot = await runtime.snapshot(teamId);
    const lead = runtimeSnapshot.agents.find((agent) => agent.role === 'lead');
    if (!lead) throw new Error(`Team lead not found for team ${teamId}`);

    const sourceAgentId = input.sourceAgentId || lead.id;
    const sourceAgent = runtimeSnapshot.agents.find((agent) => agent.id === sourceAgentId);
    if (!sourceAgent) throw new Error(`Source agent not found in team ${teamId}: ${sourceAgentId}`);
    if (sourceAgent.role !== 'lead') {
      throw new Error('Only the team lead can propose a team plan');
    }

    const now = Date.now();
    const plan = planDraftFromUnknown(input.plan, sourceAgent.id, now);
    const metadata = await this.requireMetadata(store, teamId);
    metadata.pendingPlan = plan;
    metadata.phase = 'plan_review';
    metadata.updatedAt = now;
    await store.saveTeamMetadata(teamId, metadata);

    sourceAgent.status = 'needs_input';
    sourceAgent.currentTaskId = undefined;
    sourceAgent.updatedAt = now;
    await store.saveAgent(sourceAgent);
    await runtime.setTeamStatus(teamId, 'waiting_approval', sourceAgent.id);
    this.broadcastTeamUpdate(workspaceId, metadata);

    return this.snapshot(workspaceId, teamId);
  }

  async confirmPlan(workspaceId: string, teamId: string): Promise<CanvasAgentTeamSnapshot> {
    const { runtime, store } = this.getBundle(workspaceId);
    const metadata = await this.requireMetadata(store, teamId);
    const plan = metadata.pendingPlan;
    if (!plan) {
      if (metadata.phase === 'executing') return this.snapshot(workspaceId, teamId);
      throw new Error(`No pending team plan for ${teamId}`);
    }
    const resolvedTasks = resolvePlanTaskGraph(plan.tasks);

    const before = await runtime.snapshot(teamId);
    const lead = before.agents.find((agent) => agent.role === 'lead');
    const agentsByName = new Map(
      before.agents.map((agent) => [agent.name.trim().toLowerCase(), agent]),
    );

    for (const teammate of plan.teammates) {
      const key = teammate.name.trim().toLowerCase();
      if (!key || agentsByName.has(key)) continue;

      const agentId = randomUUID();
      const nodeId = await createTeamAgentNode({
        workspaceId,
        teamId,
        frameNodeId: metadata.frameNodeId,
        agentId,
        name: teammate.name,
        role: 'teammate',
        agentType: teammate.agentType || DEFAULT_TEAMMATE_AGENT,
      });

      metadata.agentNodeIds[agentId] = nodeId;
      const agent = await runtime.addAgent({
        id: agentId,
        teamId,
        role: 'teammate',
        name: teammate.name,
        sessionRef: {
          sessionId: nodeId,
          provider: 'pulse-canvas-agent-node',
          displayName: teammate.name,
          metadata: { workspaceId, nodeId },
        },
        metadata: { canvasNodeId: nodeId },
      });
      agentsByName.set(key, agent);
    }

    for (const resolved of resolvedTasks) {
      const { task } = resolved;
      const owner = task.ownerName
        ? agentsByName.get(task.ownerName.trim().toLowerCase())
        : undefined;
      const fallbackOwner = !owner && plan.teammates.length === 1
        ? agentsByName.get(plan.teammates[0].name.trim().toLowerCase())
        : undefined;
      await runtime.createTask({
        id: resolved.id,
        teamId,
        title: task.title,
        description: task.description,
        ownerAgentId: owner?.id ?? fallbackOwner?.id,
        deps: resolved.depIds,
        createdBy: lead?.id ?? 'runtime',
        metadata: { kind: 'leader-plan-task' },
      });
    }

    const now = Date.now();
    metadata.pendingPlan = undefined;
    metadata.approvedPlan = { ...plan, updatedAt: now };
    metadata.phase = 'executing';
    metadata.updatedAt = now;
    await store.saveTeamMetadata(teamId, metadata);

    await runtime.setTeamStatus(teamId, 'running', 'human');
    await runtime.dispatchReadyTasks(teamId);
    return this.snapshot(workspaceId, teamId);
  }

  async addAgent(input: CanvasAgentTeamAddAgentInput): Promise<CanvasAgentTeamSnapshot> {
    const { runtime, store } = this.getBundle(input.workspaceId);
    const metadata = await this.requireMetadata(store, input.teamId);
    const agentId = randomUUID();
    const nodeId = await createTeamAgentNode({
      workspaceId: input.workspaceId,
      teamId: input.teamId,
      frameNodeId: metadata.frameNodeId,
      agentId,
      name: input.name,
      role: input.role,
      agentType: input.agentType || (input.role === 'lead' ? DEFAULT_LEAD_AGENT : DEFAULT_TEAMMATE_AGENT),
      cwd: input.cwd,
    });

    metadata.agentNodeIds[agentId] = nodeId;
    metadata.updatedAt = Date.now();
    await store.saveTeamMetadata(input.teamId, metadata);

    await runtime.addAgent({
      id: agentId,
      teamId: input.teamId,
      role: input.role,
      name: input.name,
      sessionRef: {
        sessionId: nodeId,
        provider: 'pulse-canvas-agent-node',
        displayName: input.name,
        metadata: { workspaceId: input.workspaceId, nodeId },
      },
      metadata: { canvasNodeId: nodeId },
    });

    if (metadata.phase === 'executing') {
      await runtime.dispatchReadyTasks(input.teamId);
    }

    return this.snapshot(input.workspaceId, input.teamId);
  }

  async createTask(input: CanvasAgentTeamCreateTaskInput): Promise<RuntimeSnapshot> {
    const { runtime } = this.getBundle(input.workspaceId);
    const snapshot = await runtime.snapshot(input.teamId);
    const owner = input.ownerAgentId || input.ownerName
      ? this.resolveAgentReference(snapshot.agents, input.ownerAgentId || input.ownerName || '')
      : undefined;
    const depRefs = input.depRefs ?? [];
    const deps = Array.from(new Set([
      ...(input.deps ?? []),
      ...this.resolveTaskReferences(snapshot.tasks, depRefs),
    ]));
    await runtime.createTask({
      teamId: input.teamId,
      title: input.title,
      description: input.description,
      ownerAgentId: owner?.id,
      deps,
      createdBy: 'human',
    });
    if (input.dispatch) {
      await runtime.dispatchReadyTasks(input.teamId);
    }
    return runtime.snapshot(input.teamId);
  }

  async dispatch(workspaceId: string, teamId: string): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    await runtime.dispatchReadyTasks(teamId);
    return this.snapshot(workspaceId, teamId);
  }

  async pauseTeam(workspaceId: string, teamId: string): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    await runtime.pauseTeam(teamId, 'Paused from the Agent Team frame.');
    await stopAgentTeamCanvasNodes(workspaceId, teamId);
    return this.snapshot(workspaceId, teamId);
  }

  async deleteTeam(workspaceId: string, teamId: string): Promise<{ deletedNodeIds: string[] }> {
    const { runtime } = this.getBundle(workspaceId);
    await runtime.deleteTeam(teamId);
    const deletedNodeIds = await removeAgentTeamCanvasNodes(workspaceId, teamId);
    for (const nodeId of deletedNodeIds) {
      this.outputBuffers.delete(`${workspaceId}:${nodeId}`);
    }
    return { deletedNodeIds };
  }

  async completeTask(
    workspaceId: string,
    teamId: string,
    taskId: string,
    result: string,
  ): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    await runtime.completeTask(taskId, result, 'human');
    await runtime.dispatchReadyTasks(teamId);
    return this.snapshot(workspaceId, teamId);
  }

  async completeAgentTask(input: CanvasAgentTeamCompleteTaskInput): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(input.workspaceId);
    const snapshot = await runtime.snapshot(input.teamId);
    const agent = input.sourceAgentId
      ? this.resolveAgentReference(snapshot.agents, input.sourceAgentId)
      : undefined;
    const task = this.resolveTaskForAction(snapshot.tasks, input.taskId, agent);
    await runtime.completeTask(task.id, input.summary, agent?.id ?? 'human');
    await runtime.dispatchReadyTasks(input.teamId);
    return this.snapshot(input.workspaceId, input.teamId);
  }

  async blockAgentTask(input: CanvasAgentTeamBlockTaskInput): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(input.workspaceId);
    const snapshot = await runtime.snapshot(input.teamId);
    const agent = input.sourceAgentId
      ? this.resolveAgentReference(snapshot.agents, input.sourceAgentId)
      : undefined;
    const task = this.resolveTaskForAction(snapshot.tasks, input.taskId, agent);
    await runtime.blockTask(task.id, input.reason, agent?.id ?? 'runtime');
    return this.snapshot(input.workspaceId, input.teamId);
  }

  async requestHumanInput(input: CanvasAgentTeamRequestHumanInput): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(input.workspaceId);
    const snapshot = await runtime.snapshot(input.teamId);
    const agent = input.sourceAgentId
      ? this.resolveAgentReference(snapshot.agents, input.sourceAgentId)
      : undefined;
    const task = this.resolveTaskForAction(snapshot.tasks, input.taskId, agent);
    await runtime.openHumanGate({
      teamId: input.teamId,
      agentId: agent?.id,
      taskId: task.id,
      reason: humanInputReasonForAgent(agent, input.reason),
      prompt: input.prompt,
      metadata: gateAudienceMetadataForAgent(agent),
    });
    return this.snapshot(input.workspaceId, input.teamId);
  }

  async publishArtifact(input: CanvasAgentTeamPublishArtifactInput): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(input.workspaceId);
    const snapshot = await runtime.snapshot(input.teamId);
    const agent = input.sourceAgentId
      ? this.resolveAgentReference(snapshot.agents, input.sourceAgentId)
      : undefined;
    const task = input.taskId || agent?.currentTaskId
      ? this.resolveTaskForAction(snapshot.tasks, input.taskId, agent)
      : undefined;
    await runtime.createArtifact({
      teamId: input.teamId,
      agentId: agent?.id,
      taskId: task?.id,
      kind: normalizeArtifactKind(input.kind),
      title: input.title,
      uri: input.uri,
      summary: input.summary,
    });
    return this.snapshot(input.workspaceId, input.teamId);
  }

  async completeTeam(
    workspaceId: string,
    teamId: string,
    input: { sourceAgentId?: string; summary: string },
  ): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    const snapshot = await runtime.snapshot(teamId);
    const agent = input.sourceAgentId
      ? this.resolveAgentReference(snapshot.agents, input.sourceAgentId)
      : undefined;
    await runtime.completeTeam(teamId, input.summary, agent?.id ?? 'human');
    return this.snapshot(workspaceId, teamId);
  }

  async answerGate(workspaceId: string, gateId: string, answer: string): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    const snapshots = await this.listTeams(workspaceId);
    const team = snapshots.find((item) => item.runtime.humanGates.some((gate) => gate.id === gateId));
    if (!team) throw new Error(`Human gate not found: ${gateId}`);
    await runtime.answerHumanGate(gateId, answer);
    await runtime.dispatchReadyTasks(team.runtime.team.id);
    return this.snapshot(workspaceId, team.runtime.team.id);
  }

  async interruptAgent(
    workspaceId: string,
    teamId: string,
    agentId: string,
    mode: 'soft' | 'ctrl-c' | 'abort',
    reason?: string,
  ): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    await runtime.interruptAgent(agentId, mode, reason);
    return this.snapshot(workspaceId, teamId);
  }

  async sendInput(
    workspaceId: string,
    teamId: string,
    agentRef: string,
    content: string,
  ): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    const snapshot = await runtime.snapshot(teamId);
    const agent = this.resolveAgentReference(snapshot.agents, agentRef);
    const input = agent.role === 'lead'
      ? formatLeadExecutionPrompt(snapshot.team.name, snapshot.team.goal, content)
      : content;
    await runtime.sendToAgent(agent.id, input);
    return this.snapshot(workspaceId, teamId);
  }

  async openHumanGate(
    workspaceId: string,
    teamId: string,
    input: { agentId?: string; taskId?: string; reason: string; prompt: string },
  ): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    await runtime.openHumanGate({
      teamId,
      agentId: input.agentId,
      taskId: input.taskId,
      reason: input.reason,
      prompt: input.prompt,
    });
    return this.snapshot(workspaceId, teamId);
  }

  async reportAgentOutput(workspaceId: string, nodeId: string, delta: string): Promise<CanvasAgentTeamSnapshot | null> {
    if (!delta) return null;
    const { runtime, store } = this.getBundle(workspaceId);
    const match = await this.findAgentByNodeId(store, nodeId);
    if (!match) return null;

    const bufferKey = `${workspaceId}:${nodeId}`;
    const previous = this.outputBuffers.get(bufferKey) ?? '';
    const combined = stripAnsi(previous + delta).slice(-MAX_AGENT_OUTPUT_BUFFER);
    const parts = combined.split(/\r\n|\n|\r/);
    const pending = parts.pop() ?? '';
    this.outputBuffers.set(bufferKey, pending.slice(-MAX_AGENT_OUTPUT_BUFFER));

    let changed = false;
    for (const line of parts) {
      const marker = parseAgentOutputMarker(line);
      if (!marker) continue;
      changed = (await this.applyAgentOutputMarker(runtime, store, match.agent, marker)) || changed;
    }
    const pendingMarker = parseAgentOutputMarker(pending);
    if (pendingMarker && pendingMarker.text.trim()) {
      changed = (await this.applyAgentOutputMarker(runtime, store, match.agent, pendingMarker)) || changed;
      this.outputBuffers.set(bufferKey, '');
    }

    if (!changed) return null;
    return this.snapshot(workspaceId, match.teamId);
  }

  async reportAgentExit(workspaceId: string, nodeId: string, code?: number): Promise<CanvasAgentTeamSnapshot | null> {
    const { runtime, store } = this.getBundle(workspaceId);
    const match = await this.findAgentByNodeId(store, nodeId);
    if (!match) return null;

    const bufferKey = `${workspaceId}:${nodeId}`;
    const pending = this.outputBuffers.get(bufferKey);
    let changed = false;
    if (pending) {
      const marker = parseAgentOutputMarker(pending);
      if (marker) {
        changed = await this.applyAgentOutputMarker(runtime, store, match.agent, marker);
      }
      this.outputBuffers.delete(bufferKey);
    }

    const latestAgent = await store.getAgent(match.agent.id);
    if (!latestAgent?.currentTaskId) {
      return changed ? this.snapshot(workspaceId, match.teamId) : null;
    }
    const reason = code == null
      ? 'Agent session exited before reporting task completion.'
      : `Agent session exited with code ${code} before reporting task completion.`;
    await runtime.requestTaskReview(latestAgent.currentTaskId, reason, latestAgent.id);
    return this.snapshot(workspaceId, match.teamId);
  }

  async snapshot(workspaceId: string, teamId: string): Promise<CanvasAgentTeamSnapshot> {
    const { runtime, store } = this.getBundle(workspaceId);
    await ensureAgentTeamCanvasLayout(workspaceId, teamId);
    await this.repairLegacyOutputMarkerBlocks(store, teamId);
    await runtime.notifyLeadPendingGates(teamId);
    const metadata = await store.getTeamMetadata(teamId);
    const runtimeSnapshot = await runtime.snapshot(teamId);
    return {
      workspaceId,
      frameNodeId: metadata?.frameNodeId,
      phase: inferPhase(metadata, runtimeSnapshot),
      pendingPlan: metadata?.pendingPlan,
      approvedPlan: metadata?.approvedPlan,
      runtime: runtimeSnapshot,
    };
  }

  async listTeams(workspaceId: string): Promise<CanvasAgentTeamSnapshot[]> {
    const { runtime, store } = this.getBundle(workspaceId);
    const entries = await store.listTeamMetadata();
    const snapshots: CanvasAgentTeamSnapshot[] = [];
    for (const entry of entries) {
      try {
        await ensureAgentTeamCanvasLayout(workspaceId, entry.teamId);
        await this.repairLegacyOutputMarkerBlocks(store, entry.teamId);
        await runtime.notifyLeadPendingGates(entry.teamId);
        const runtimeSnapshot = await runtime.snapshot(entry.teamId);
        snapshots.push({
          workspaceId,
          frameNodeId: entry.metadata.frameNodeId,
          phase: inferPhase(entry.metadata, runtimeSnapshot),
          pendingPlan: entry.metadata.pendingPlan,
          approvedPlan: entry.metadata.approvedPlan,
          runtime: runtimeSnapshot,
        });
      } catch (err) {
        console.warn(`[agent-teams] failed to snapshot team ${entry.teamId}:`, err);
      }
    }
    return snapshots;
  }

  private getBundle(workspaceId: string): RuntimeBundle {
    const existing = this.runtimes.get(workspaceId);
    if (existing) return existing;

    const store = new CanvasAgentTeamStore(workspaceId);
    const adapter = new CanvasAgentSessionAdapter(workspaceId, store);
    const runtime = new TeamRuntime({
      store,
      agentSessions: adapter,
    });
    const bundle = { store, runtime };
    this.runtimes.set(workspaceId, bundle);
    return bundle;
  }

  private async requireMetadata(store: CanvasAgentTeamStore, teamId: string): Promise<CanvasAgentTeamMetadata> {
    const metadata = await store.getTeamMetadata(teamId);
    if (!metadata) throw new Error(`Team metadata not found: ${teamId}`);
    return metadata;
  }

  private broadcastTeamUpdate(workspaceId: string, metadata: CanvasAgentTeamMetadata): void {
    const nodeIds = [
      metadata.frameNodeId,
      ...Object.values(metadata.agentNodeIds),
    ].filter((nodeId): nodeId is string => !!nodeId);
    if (nodeIds.length > 0) {
      broadcastCanvasUpdate(workspaceId, nodeIds, 'update', 'agent-teams');
    }
  }

  private async findAgentByNodeId(store: CanvasAgentTeamStore, nodeId: string): Promise<AgentNodeMatch | null> {
    const entries = await store.listTeamMetadata();
    for (const entry of entries) {
      const agentId = Object.entries(entry.metadata.agentNodeIds)
        .find(([, candidateNodeId]) => candidateNodeId === nodeId)?.[0];
      if (!agentId) continue;
      const agent = await store.getAgent(agentId);
      if (agent) return { teamId: entry.teamId, agent };
    }
    return null;
  }

  private resolveAgentReference(agents: TeamAgentRecord[], ref: string): TeamAgentRecord {
    const trimmed = ref.trim();
    if (!trimmed) throw new Error('Agent reference is required');
    const byId = agents.find((agent) => agent.id === trimmed);
    if (byId) return byId;

    const key = trimmed.toLowerCase();
    const matches = agents.filter((agent) => agent.name.trim().toLowerCase() === key);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`Agent reference is ambiguous: ${ref}`);
    throw new Error(`Agent not found: ${ref}`);
  }

  private resolveTaskReferences(tasks: TeamTaskRecord[], refs: string[]): string[] {
    return refs.map((ref) => {
      const trimmed = ref.trim();
      if (!trimmed) throw new Error('Task dependency reference is empty');
      const byId = tasks.find((task) => task.id === trimmed);
      if (byId) return byId.id;

      const key = trimmed.toLowerCase();
      const matches = tasks.filter((task) => task.title.trim().toLowerCase() === key);
      if (matches.length === 1) return matches[0].id;
      if (matches.length > 1) throw new Error(`Task dependency reference is ambiguous: ${ref}`);
      throw new Error(`Task dependency not found: ${ref}`);
    });
  }

  private resolveTaskForAction(
    tasks: TeamTaskRecord[],
    taskRef: string | undefined,
    agent: TeamAgentRecord | undefined,
  ): TeamTaskRecord {
    if (taskRef) {
      const [taskId] = this.resolveTaskReferences(tasks, [taskRef]);
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (task) return task;
    }
    if (agent?.currentTaskId) {
      const task = tasks.find((candidate) => candidate.id === agent.currentTaskId);
      if (task) return task;
    }
    throw new Error('Task ID required when source agent has no current task');
  }

  private async applyAgentOutputMarker(
    runtime: TeamRuntime,
    store: CanvasAgentTeamStore,
    agent: TeamAgentRecord,
    marker: AgentOutputMarker,
  ): Promise<boolean> {
    const taskId = marker.taskId || agent.currentTaskId;
    const text = marker.text.trim();

    if (marker.kind === 'plan') {
      if (agent.role !== 'lead') return false;
      const now = Date.now();
      const plan = parsePlanDraft(text, agent.id, now);
      if (!plan) return false;
      const metadata = await this.requireMetadata(store, agent.teamId);
      metadata.pendingPlan = plan;
      metadata.phase = 'plan_review';
      metadata.updatedAt = now;
      await store.saveTeamMetadata(agent.teamId, metadata);
      agent.status = 'needs_input';
      agent.currentTaskId = undefined;
      agent.updatedAt = now;
      await store.saveAgent(agent);
      await runtime.setTeamStatus(agent.teamId, 'waiting_approval', agent.id);
      return true;
    }

    if (marker.kind === 'artifact') {
      const title = marker.artifactTitle?.trim() || text || 'Agent artifact';
      const artifactKind = marker.artifactKind?.trim() || 'other';
      await runtime.createArtifact({
        teamId: agent.teamId,
        agentId: agent.id,
        taskId,
        kind: normalizeArtifactKind(artifactKind),
        title,
        summary: text || title,
      });
      return true;
    }

    if (marker.kind === 'human-input-needed') {
      const snapshot = await runtime.snapshot(agent.teamId);
      const duplicateGate = snapshot.humanGates.some((gate) =>
        gate.status === 'open'
        && gate.agentId === agent.id
        && gate.taskId === taskId
        && gate.prompt === text
      );
      if (duplicateGate) return false;
      await runtime.openHumanGate({
        teamId: agent.teamId,
        agentId: agent.id,
        taskId,
        reason: humanInputReasonForAgent(agent, undefined),
        prompt: text || 'Agent requested human input.',
        metadata: gateAudienceMetadataForAgent(agent),
      });
      return true;
    }

    return false;
  }

  private async repairLegacyOutputMarkerBlocks(store: CanvasAgentTeamStore, teamId: string): Promise<void> {
    const [tasks, agents] = await Promise.all([
      store.listTasks(teamId),
      store.listAgents(teamId),
    ]);
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const now = Date.now();
    for (const task of tasks) {
      if (task.status !== 'blocked' || task.blockedReason !== LEGACY_OUTPUT_BLOCK_REASON || !task.ownerAgentId) {
        continue;
      }
      const agent = agentsById.get(task.ownerAgentId);
      if (!agent || agent.currentTaskId !== task.id) continue;
      task.status = 'in_progress';
      task.blockedReason = undefined;
      task.updatedAt = now;
      await store.saveTask(task);
      if (agent.status === 'blocked') {
        agent.status = 'running';
        agent.updatedAt = now;
        await store.saveAgent(agent);
      }
    }
  }
}

let service: CanvasAgentTeamsService | null = null;

export function getCanvasAgentTeamsService(): CanvasAgentTeamsService {
  if (!service) service = new CanvasAgentTeamsService();
  return service;
}
