import { randomUUID } from 'crypto';
import { statSync } from 'fs';
import { homedir } from 'os';
import {
  TASK_REVIEW_KIND_SESSION_EXIT,
  TeamRuntime,
  readTaskReviewKind,
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
  updateAgentTeamCanvasCwd,
} from './canvas-nodes';
import { CanvasAgentTeamStore } from './store';
import { broadcastAgentTeamsEvent, broadcastCanvasUpdate } from '../canvas/broadcast';
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
  /**
   * Last time an external operation (IPC, control-server, agent output) or a
   * runtime event touched this workspace. The maintenance loop skips
   * workspaces idle beyond MAINTENANCE_IDLE_MS so stale ones stop costing
   * periodic canvas reads; any new operation reactivates them.
   */
  lastActivityAt: number;
}

const DEFAULT_LEAD_AGENT = 'codex';
const DEFAULT_TEAMMATE_AGENT = 'codex';
const MAX_AGENT_OUTPUT_BUFFER = 16_000;
const MAINTENANCE_INTERVAL_MS = 5_000;
const MAINTENANCE_IDLE_MS = 30 * 60_000;
// Layout migration/repair reads canvas.json from disk, so run it on a slower
// cadence than the in-memory state repairs and lead nudges.
const MAINTENANCE_LAYOUT_EVERY_TICKS = 6;
// Events/messages are unbounded audit logs the team UI never renders in full;
// cap what each IPC/HTTP snapshot carries.
const SNAPSHOT_LOG_LIMIT = 100;
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
const SESSION_EXIT_REVIEW_REASON_RE = /^Agent session exited(?: with code -?\d+)? before reporting task completion\.$/;
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

const isRecoverableSessionExitReview = (task: TeamTaskRecord, agentId: string): boolean =>
  task.status === 'needs_review'
  && task.ownerAgentId === agentId
  && (
    readTaskReviewKind(task.metadata) === TASK_REVIEW_KIND_SESSION_EXIT
    // Tasks persisted before the structured marker only carry the reason text.
    || (typeof task.blockedReason === 'string' && SESSION_EXIT_REVIEW_REASON_RE.test(task.blockedReason))
  );

const clearTaskReviewKind = (task: TeamTaskRecord): void => {
  if (!task.metadata || !('reviewKind' in task.metadata)) return;
  const { reviewKind: _removed, ...rest } = task.metadata;
  task.metadata = Object.keys(rest).length > 0 ? rest : undefined;
};

const trimRuntimeSnapshotForClient = (snapshot: RuntimeSnapshot): RuntimeSnapshot => ({
  ...snapshot,
  events: snapshot.events.slice(-SNAPSHOT_LOG_LIMIT),
  messages: snapshot.messages.slice(-SNAPSHOT_LOG_LIMIT),
});

const asPlainObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const cleanString = (value: unknown, fallback = ''): string => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
};

const expandHomePath = (value: string): string =>
  value === '~' || value.startsWith('~/')
    ? value.replace(/^~/, homedir())
    : value;

const trimPathToken = (value: string): string =>
  value.replace(/[),.;:!?，。；：、]+$/u, '');

const isExistingDirectory = (value: string): boolean => {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
};

const inferWorkingDirectoryFromText = (content: string): string | undefined => {
  const matches = content.matchAll(/(?:^|[\s([{"'`])(?<path>~?\/[^\s)\]}"'`，。；：、]+)/gu);
  const candidates = Array.from(matches)
    .map((match) => trimPathToken(match.groups?.path ?? ''))
    .filter((candidate) => candidate.length > 1)
    .map(expandHomePath)
    .sort((a, b) => b.length - a.length);

  return candidates.find(isExistingDirectory);
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

const metadataCanvasNodeIds = (metadata: CanvasAgentTeamMetadata | undefined): string[] => [
  metadata?.frameNodeId,
  ...Object.values(metadata?.agentNodeIds ?? {}),
].filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0);

const formatLeaderBriefingPrompt = (teamName: string, goal: string, content: string, cwd?: string): string => [
  `You are the Team Leader for "${teamName}" in Pulse Canvas.`,
  '',
  `Current team goal: ${goal || 'Clarify the goal with the user.'}`,
  ...(cwd
    ? [
      '',
      `Team working directory: ${cwd}`,
      'All teammate nodes created from this plan will start in this directory. Plan tasks against this path unless the user explicitly asks for a different location.',
    ]
    : []),
  '',
  'Your only job in this phase is to clarify requirements and draft a Pulse Canvas Agent Team plan.',
  'Do not implement the task yourself.',
  'Do not spawn teammates yourself; Pulse Canvas will create teammate nodes only after the user approves your plan.',
  'If there is already a pending plan and the user asks for changes — including changes requested directly in this conversation — you MUST revise and resubmit the full plan by re-running propose-plan. A chat reply alone does NOT update the plan: the task graph shown to the user and the "Approve & Run" action keep using the last submitted plan until you re-run propose-plan. So after agreeing to any change, immediately resubmit the updated plan. Do not create execution tasks during plan review.',
  '',
  'When the plan is ready for user approval, submit it through the Pulse Canvas CLI instead of writing a terminal marker.',
  'Prefer --plan-json so you do not need to edit a temporary file. Use this JSON shape:',
  '{"summary":"short plan summary","teammates":[{"name":"Backend Codex","agentType":"codex"},{"name":"Frontend Codex","agentType":"codex"},{"name":"QA Codex","agentType":"codex"}],"tasks":[{"title":"Define API contract","description":"Concrete instructions and expected output.","ownerName":"Backend Codex","deps":[]},{"title":"Implement frontend integration","description":"Concrete instructions and expected output.","ownerName":"Frontend Codex","deps":["Define API contract"]},{"title":"QA integration and fixes","description":"Verify the completed backend/frontend flow and report or fix issues.","ownerName":"QA Codex","deps":["Define API contract","Implement frontend integration"]}]}',
  '',
  'Every task object MUST include "deps": [] or a list of exact task titles from the same plan.',
  'Use deps to encode the real execution order. Do not rely on wording like "after" or "then" in descriptions.',
  'Plan the smallest DAG that still exposes useful parallel work: usually 3-6 teammates and 4-10 tasks for normal app/repo work. Go above 10 tasks only when there are truly independent deliverables.',
  'Target 2-4 ready-to-start workstreams. Do not serialize the whole graph behind one setup/research task, and do not create one microtask per file, component, command, or tiny edit.',
  'Aim for at least 2-3 tasks runnable in parallel at every stage of the DAG. If a task only blocks one downstream task, consider whether they can run concurrently with a shared contract instead of a hard dependency.',
  'Each teammate should usually own 1-2 meaningful tasks. Split by durable ownership or artifact boundary, not by mechanical steps.',
  'Use deps only for real handoffs: a task depends on another task only when it needs that task\'s concrete output or contract.',
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
  'You are the Team Leader during execution. You coordinate the team.',
  'You may do lightweight integration and coordination yourself: answer the human directly, summarize status, explain how the pieces fit together, and lay out how the project should be accepted and delivered. A quick read to answer such questions is fine.',
  'Do not take over a teammate\'s detailed implementation work. Do not write or edit feature code, build out deliverables, or run builds, installs, dev servers, or tests to implement the change — hand that to a teammate instead of doing it yourself.',
  'First decide what the follow-up needs:',
  'If it is a question or a coordination / acceptance / delivery matter you can handle as lead, just reply — do not create a task.',
  'Otherwise, decide whether it modifies existing work or creates genuinely new work.',
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
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private maintenanceTick = 0;
  private maintenanceRunning = false;

  /**
   * Start the main-process maintenance heartbeat.
   *
   * State repairs, lead nudges, layout migration, and the dispatch safety net
   * used to piggyback on `snapshot()`/`listTeams()`, which made them run only
   * while some renderer polled an open AgentTeamFrame — and made reads carry
   * write side effects. The heartbeat owns that upkeep now; reads are pure.
   */
  startMaintenanceLoop(intervalMs = MAINTENANCE_INTERVAL_MS): void {
    if (this.maintenanceTimer) return;
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenance();
    }, intervalMs);
    this.maintenanceTimer.unref?.();
  }

  stopMaintenanceLoop(): void {
    if (!this.maintenanceTimer) return;
    clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = null;
  }

  /** One heartbeat tick over every active (recently touched) workspace. */
  async runMaintenance(now = Date.now()): Promise<void> {
    if (this.maintenanceRunning) return;
    this.maintenanceRunning = true;
    this.maintenanceTick += 1;
    const ensureLayout = this.maintenanceTick % MAINTENANCE_LAYOUT_EVERY_TICKS === 1;
    try {
      for (const [workspaceId, bundle] of this.runtimes) {
        if (now - bundle.lastActivityAt > MAINTENANCE_IDLE_MS) continue;
        const entries = await bundle.store.listTeamMetadata().catch(() => []);
        for (const entry of entries) {
          try {
            await this.maintainTeam(workspaceId, entry.teamId, { ensureLayout });
          } catch (err) {
            console.warn(`[agent-teams] maintenance failed for team ${entry.teamId}:`, err);
          }
        }
      }
    } finally {
      this.maintenanceRunning = false;
    }
  }

  async maintainTeam(
    workspaceId: string,
    teamId: string,
    opts: { ensureLayout?: boolean } = {},
  ): Promise<void> {
    const { runtime, store } = this.getBundle(workspaceId, { touch: false });
    if (opts.ensureLayout !== false) {
      await ensureAgentTeamCanvasLayout(workspaceId, teamId);
    }
    await this.repairLegacyOutputMarkerBlocks(store, teamId);
    await this.repairAnsweredHumanGateBlocks(store, teamId);
    // Dispatch safety net: catch ready work that no mutation-driven dispatch
    // picked up (e.g. an agent that went idle through a session event). Runs
    // before the lead nudges so they see post-dispatch team status.
    await runtime.repairCurrentRound(teamId);
    await runtime.dispatchReadyTasks(teamId);
    await runtime.notifyLeadPendingGates(teamId);
    await runtime.notifyLeadReviewIfStalled(teamId);
  }

  async createTeam(input: CanvasAgentTeamCreateInput): Promise<CanvasAgentTeamSnapshot> {
    const { runtime, store } = this.getBundle(input.workspaceId);
    const teamId = randomUUID();
    const leadAgentId = randomUUID();

    await runtime.createTeam({
      id: teamId,
      name: input.name,
      goal: input.goal,
      metadata: { workspaceId: input.workspaceId, cwd: input.cwd },
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
      cwd: input.cwd,
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
      cwd: input.cwd,
      sessionRef: {
        sessionId: createdNodes.agentNodeIds[leadAgentId],
        provider: 'pulse-canvas-agent-node',
        displayName: input.leadName || 'Team Lead',
        metadata: { workspaceId: input.workspaceId, nodeId: createdNodes.agentNodeIds[leadAgentId], cwd: input.cwd },
      },
      metadata: { canvasNodeId: createdNodes.agentNodeIds[leadAgentId], cwd: input.cwd },
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

    const metadata = await this.requireMetadata(store, teamId);
    const inferredCwd = metadata.phase !== 'executing'
      ? inferWorkingDirectoryFromText(trimmed)
      : undefined;
    if (inferredCwd && metadata.cwd !== inferredCwd) {
      metadata.cwd = inferredCwd;
      metadata.updatedAt = Date.now();
      lead.cwd = inferredCwd;
      lead.metadata = { ...(lead.metadata ?? {}), cwd: inferredCwd };
      if (lead.sessionRef) {
        lead.sessionRef = {
          ...lead.sessionRef,
          metadata: { ...(lead.sessionRef.metadata ?? {}), cwd: inferredCwd },
        };
      }
      await store.saveTeamMetadata(teamId, metadata);
      await store.saveAgent(lead);
      await updateAgentTeamCanvasCwd(workspaceId, teamId, inferredCwd);
    }

    await runtime.sendToAgent(
      lead.id,
      formatLeaderBriefingPrompt(snapshot.team.name, snapshot.team.goal, trimmed, metadata.cwd),
    );
    lead.status = 'running';
    lead.updatedAt = Date.now();
    await store.saveAgent(lead);

    if (metadata.phase !== 'plan_review' && metadata.phase !== 'executing') {
      metadata.phase = 'briefing';
      metadata.updatedAt = Date.now();
      await store.saveTeamMetadata(teamId, metadata);
    }

    this.emitTeamsChanged(workspaceId, teamId, 'lead_briefed');
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
    // setTeamStatus only emits on change, so a revised plan re-proposed while
    // already waiting_approval needs an explicit push.
    this.emitTeamsChanged(workspaceId, teamId, 'plan_proposed');

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
    const teamCwd = metadata.cwd
      || lead?.cwd
      || cleanString(lead?.metadata?.cwd);
    if (teamCwd && metadata.cwd !== teamCwd) {
      metadata.cwd = teamCwd;
    }
    const agentsByName = new Map(
      before.agents.map((agent) => [agent.name.trim().toLowerCase(), agent]),
    );

    const idleTeammates = before.agents
      .filter((a) => a.role === 'teammate' && a.status === 'idle')
      .map((a) => a);
    const reusedAgentIds = new Set<string>();

    for (const teammate of plan.teammates) {
      const key = teammate.name.trim().toLowerCase();
      if (!key || agentsByName.has(key)) continue;

      const reusable = idleTeammates.find((a) => !reusedAgentIds.has(a.id));
      if (reusable) {
        reusedAgentIds.add(reusable.id);
        agentsByName.set(key, reusable);
        continue;
      }

      const agentId = randomUUID();
      const nodeId = await createTeamAgentNode({
        workspaceId,
        teamId,
        frameNodeId: metadata.frameNodeId,
        agentId,
        name: teammate.name,
        role: 'teammate',
        agentType: teammate.agentType || DEFAULT_TEAMMATE_AGENT,
        cwd: teamCwd,
      });

      metadata.agentNodeIds[agentId] = nodeId;
      const agent = await runtime.addAgent({
        id: agentId,
        teamId,
        role: 'teammate',
        name: teammate.name,
        cwd: teamCwd,
        sessionRef: {
          sessionId: nodeId,
          provider: 'pulse-canvas-agent-node',
          displayName: teammate.name,
          metadata: { workspaceId, nodeId, cwd: teamCwd },
        },
        metadata: { canvasNodeId: nodeId, cwd: teamCwd },
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

    await runtime.initializeRound(teamId);
    await runtime.setTeamStatus(teamId, 'running', 'human');
    await runtime.dispatchReadyTasks(teamId);
    await runtime.notifyLeadPlanApproved(teamId);
    return this.snapshot(workspaceId, teamId);
  }

  async updatePlanTeammate(
    workspaceId: string,
    teamId: string,
    input: { teammateName: string; agentType: string },
  ): Promise<CanvasAgentTeamSnapshot> {
    const { store } = this.getBundle(workspaceId);
    const metadata = await this.requireMetadata(store, teamId);
    if (metadata.phase !== 'plan_review' || !metadata.pendingPlan) {
      throw new Error('Teammates can only be re-assigned while the plan is under review');
    }
    const agentType = cleanString(input.agentType);
    if (!agentType) throw new Error('Agent type is required');

    const key = cleanString(input.teammateName).toLowerCase();
    const teammate = metadata.pendingPlan.teammates.find(
      (candidate) => candidate.name.trim().toLowerCase() === key,
    );
    if (!teammate) throw new Error(`Teammate not found in plan: ${input.teammateName}`);
    if (teammate.agentType === agentType) return this.snapshot(workspaceId, teamId);

    const now = Date.now();
    teammate.agentType = agentType;
    metadata.pendingPlan.updatedAt = now;
    metadata.updatedAt = now;
    await store.saveTeamMetadata(teamId, metadata);
    this.broadcastTeamUpdate(workspaceId, metadata);
    this.emitTeamsChanged(workspaceId, teamId, 'plan_teammate_updated');

    return this.snapshot(workspaceId, teamId);
  }

  async addAgent(input: CanvasAgentTeamAddAgentInput): Promise<CanvasAgentTeamSnapshot> {
    const { runtime, store } = this.getBundle(input.workspaceId);
    const metadata = await this.requireMetadata(store, input.teamId);
    const agentId = randomUUID();
    const cwd = input.cwd || metadata.cwd;
    const nodeId = await createTeamAgentNode({
      workspaceId: input.workspaceId,
      teamId: input.teamId,
      frameNodeId: metadata.frameNodeId,
      agentId,
      name: input.name,
      role: input.role,
      agentType: input.agentType || (input.role === 'lead' ? DEFAULT_LEAD_AGENT : DEFAULT_TEAMMATE_AGENT),
      cwd,
    });

    metadata.agentNodeIds[agentId] = nodeId;
    metadata.updatedAt = Date.now();
    await store.saveTeamMetadata(input.teamId, metadata);

    await runtime.addAgent({
      id: agentId,
      teamId: input.teamId,
      role: input.role,
      name: input.name,
      cwd,
      sessionRef: {
        sessionId: nodeId,
        provider: 'pulse-canvas-agent-node',
        displayName: input.name,
        metadata: { workspaceId: input.workspaceId, nodeId, cwd },
      },
      metadata: { canvasNodeId: nodeId, cwd },
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
      // Follow-up tasks on a reopened team start a new round; align the
      // team's current round first or dispatch would skip them.
      await runtime.repairCurrentRound(input.teamId);
      await runtime.dispatchReadyTasks(input.teamId);
    }
    return trimRuntimeSnapshotForClient(await runtime.snapshot(input.teamId));
  }

  async dispatch(workspaceId: string, teamId: string): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    await runtime.repairCurrentRound(teamId);
    await runtime.dispatchReadyTasks(teamId);
    return this.snapshot(workspaceId, teamId);
  }

  async pauseTeam(workspaceId: string, teamId: string): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    await runtime.pauseTeam(teamId, 'Paused from the Agent Team frame.');
    await stopAgentTeamCanvasNodes(workspaceId, teamId);
    return this.snapshot(workspaceId, teamId);
  }

  async resumeTeam(workspaceId: string, teamId: string): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    await runtime.resumeTeam(teamId, 'Resumed from the Agent Team frame.');
    await runtime.dispatchReadyTasks(teamId);
    return this.snapshot(workspaceId, teamId);
  }

  async advanceRound(workspaceId: string, teamId: string): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    await runtime.advanceRound(teamId, 'human');
    await runtime.dispatchReadyTasks(teamId);
    return this.snapshot(workspaceId, teamId);
  }

  async finalizeFromCheckpoint(workspaceId: string, teamId: string): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    await runtime.finalizeFromCheckpoint(teamId, 'human');
    return this.snapshot(workspaceId, teamId);
  }

  async updateTask(
    workspaceId: string,
    teamId: string,
    taskId: string,
    patch: { title?: string; description?: string },
  ): Promise<CanvasAgentTeamSnapshot> {
    const { runtime } = this.getBundle(workspaceId);
    await runtime.updateTaskDescription(taskId, patch);
    return this.snapshot(workspaceId, teamId);
  }

  async deleteTeam(workspaceId: string, teamId: string): Promise<{ deletedNodeIds: string[] }> {
    const { runtime, store } = this.getBundle(workspaceId);
    const metadata = await store.getTeamMetadata(teamId);
    const knownNodeIds = metadataCanvasNodeIds(metadata);

    try {
      await runtime.deleteTeam(teamId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== `Team not found: ${teamId}`) throw err;
      await store.deleteTeam(teamId);
    }

    const deletedNodeIds = await removeAgentTeamCanvasNodes(workspaceId, teamId, knownNodeIds);
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
    taskRef?: string,
  ): Promise<CanvasAgentTeamSnapshot> {
    const { runtime, store } = this.getBundle(workspaceId);
    const snapshot = await runtime.snapshot(teamId);
    const agent = this.resolveAgentReference(snapshot.agents, agentRef);
    const input = agent.role === 'lead'
      ? formatLeadExecutionPrompt(snapshot.team.name, snapshot.team.goal, content)
      : content;

    // When the lead targets a specific task (e.g. answering one of several open
    // teammate questions), resolve it so we can pick the exact gate instead of
    // guessing from the agent's current/needs-input state.
    const targetTaskId = taskRef
      ? this.resolveTaskReferences(snapshot.tasks, [taskRef])[0]
      : undefined;
    const openGate = agent.role === 'lead'
      ? undefined
      : this.resolveOpenGateForAgent(snapshot, agent, targetTaskId);
    if (openGate) {
      await runtime.answerHumanGate(openGate.id, input);
      await runtime.dispatchReadyTasks(teamId);
      return this.snapshot(workspaceId, teamId);
    }

    if (agent.role === 'lead' && (snapshot.team.status === 'completed' || snapshot.team.status === 'waiting_approval')) {
      const latestAgent = await store.getAgent(agent.id);
      if (latestAgent && (latestAgent.status === 'needs_input' || latestAgent.status === 'idle' || latestAgent.status === 'stopped')) {
        latestAgent.status = 'running';
        latestAgent.currentTaskId = undefined;
        latestAgent.updatedAt = Date.now();
        await store.saveAgent(latestAgent);
      }
      // A human follow-up to the lead of a completed team reopens it: the lead
      // is expected to resume and create the next round of work, and auto-resume
      // only relaunches lead sessions for teams that allow work.
      if (snapshot.team.status === 'completed') {
        await runtime.setTeamStatus(teamId, 'running', 'human');
      }
    }

    // Forward the explicit task so the runtime resolver scopes to it too: an
    // unmatched --task must send a plain (task-tagged) message rather than fall
    // back to answering the agent's current-task gate.
    await runtime.sendToAgent(agent.id, input, targetTaskId);
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
      changed = (await this.applyAgentOutputMarker(workspaceId, runtime, store, match.agent, marker)) || changed;
    }
    const pendingMarker = parseAgentOutputMarker(pending);
    if (pendingMarker && pendingMarker.text.trim()) {
      changed = (await this.applyAgentOutputMarker(workspaceId, runtime, store, match.agent, pendingMarker)) || changed;
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
        changed = await this.applyAgentOutputMarker(workspaceId, runtime, store, match.agent, marker);
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
    await runtime.requestTaskReview(latestAgent.currentTaskId, reason, latestAgent.id, {
      kind: TASK_REVIEW_KIND_SESSION_EXIT,
    });
    return this.snapshot(workspaceId, match.teamId);
  }

  async prepareAgentAutoResume(
    workspaceId: string,
    teamId: string,
    agentId: string,
  ): Promise<{ canResume: boolean; snapshot: CanvasAgentTeamSnapshot }> {
    const { runtime, store } = this.getBundle(workspaceId);
    await ensureAgentTeamCanvasLayout(workspaceId, teamId);
    await this.repairLegacyOutputMarkerBlocks(store, teamId);
    await this.repairAnsweredHumanGateBlocks(store, teamId);

    const [team, agent, tasks, metadata] = await Promise.all([
      store.getTeam(teamId),
      store.getAgent(agentId),
      store.listTasks(teamId),
      store.getTeamMetadata(teamId),
    ]);
    if (!team || !agent || agent.teamId !== teamId) {
      return { canResume: false, snapshot: await this.snapshot(workspaceId, teamId) };
    }

    const isPlanReviewLead = agent.role === 'lead'
      && team.status === 'waiting_approval'
      && metadata?.phase === 'plan_review'
      && !!metadata.pendingPlan;
    const teamAllowsWork = team.status === 'running' || team.status === 'reviewing' || isPlanReviewLead;
    if (!teamAllowsWork) {
      return { canResume: false, snapshot: await this.snapshot(workspaceId, teamId) };
    }

    const now = Date.now();
    let canResume = false;

    if (agent.status === 'running') {
      if (agent.role === 'lead') {
        canResume = true;
      } else if (agent.currentTaskId) {
        const currentTask = tasks.find((task) => task.id === agent.currentTaskId);
        canResume = currentTask?.status === 'in_progress';
      }
    } else if (agent.role === 'lead' && agent.status === 'idle' && teamAllowsWork) {
      agent.status = 'running';
      agent.updatedAt = now;
      await store.saveAgent(agent);
      canResume = true;
    } else if (isPlanReviewLead && agent.status === 'needs_input') {
      agent.status = 'running';
      agent.updatedAt = now;
      await store.saveAgent(agent);
      canResume = true;
    }

    if (!canResume) {
      const recoverableTask = tasks.find((task) => isRecoverableSessionExitReview(task, agent.id));
      if (recoverableTask) {
        recoverableTask.status = 'in_progress';
        recoverableTask.blockedReason = undefined;
        clearTaskReviewKind(recoverableTask);
        recoverableTask.updatedAt = now;
        await store.saveTask(recoverableTask);

        agent.status = 'running';
        agent.currentTaskId = recoverableTask.id;
        agent.updatedAt = now;
        await store.saveAgent(agent);
        await runtime.setTeamStatus(teamId, 'running', 'runtime');
        canResume = true;
      }
    }

    return { canResume, snapshot: await this.snapshot(workspaceId, teamId) };
  }

  /**
   * Pure read of one team's state. Maintenance side effects (repairs, lead
   * nudges, layout) run on the heartbeat (`maintainTeam`), not here.
   */
  async snapshot(workspaceId: string, teamId: string): Promise<CanvasAgentTeamSnapshot> {
    const { runtime, store } = this.getBundle(workspaceId);
    const metadata = await store.getTeamMetadata(teamId);
    const runtimeSnapshot = await runtime.snapshot(teamId);
    return {
      workspaceId,
      frameNodeId: metadata?.frameNodeId,
      phase: inferPhase(metadata, runtimeSnapshot),
      pendingPlan: metadata?.pendingPlan,
      approvedPlan: metadata?.approvedPlan,
      runtime: trimRuntimeSnapshotForClient(runtimeSnapshot),
    };
  }

  async listTeams(workspaceId: string): Promise<CanvasAgentTeamSnapshot[]> {
    const { runtime, store } = this.getBundle(workspaceId);
    const entries = await store.listTeamMetadata();
    const snapshots: CanvasAgentTeamSnapshot[] = [];
    for (const entry of entries) {
      try {
        const runtimeSnapshot = await runtime.snapshot(entry.teamId);
        snapshots.push({
          workspaceId,
          frameNodeId: entry.metadata.frameNodeId,
          phase: inferPhase(entry.metadata, runtimeSnapshot),
          pendingPlan: entry.metadata.pendingPlan,
          approvedPlan: entry.metadata.approvedPlan,
          runtime: trimRuntimeSnapshotForClient(runtimeSnapshot),
        });
      } catch (err) {
        console.warn(`[agent-teams] failed to snapshot team ${entry.teamId}:`, err);
      }
    }
    return snapshots;
  }

  private getBundle(workspaceId: string, options: { touch?: boolean } = {}): RuntimeBundle {
    const existing = this.runtimes.get(workspaceId);
    if (existing) {
      if (options.touch !== false) existing.lastActivityAt = Date.now();
      return existing;
    }

    const store = new CanvasAgentTeamStore(workspaceId);
    const adapter = new CanvasAgentSessionAdapter(workspaceId, store);
    const runtime = new TeamRuntime({
      store,
      agentSessions: adapter,
    });
    const bundle: RuntimeBundle = { store, runtime, lastActivityAt: Date.now() };
    // Push every runtime event to the renderer so open team frames refresh
    // immediately instead of waiting for their fallback poll.
    runtime.onEvent((event) => {
      bundle.lastActivityAt = Date.now();
      try {
        broadcastAgentTeamsEvent({
          workspaceId,
          teamId: event.teamId,
          type: event.type,
          timestamp: event.timestamp,
        });
      } catch (err) {
        console.warn('[agent-teams] failed to broadcast team event:', err);
      }
    });
    this.runtimes.set(workspaceId, bundle);
    return bundle;
  }

  private async requireMetadata(store: CanvasAgentTeamStore, teamId: string): Promise<CanvasAgentTeamMetadata> {
    const metadata = await store.getTeamMetadata(teamId);
    if (!metadata) throw new Error(`Team metadata not found: ${teamId}`);
    return metadata;
  }

  /**
   * Push a team-changed signal for mutations that only touch canvas team
   * metadata and therefore emit no TeamRuntime event.
   */
  private emitTeamsChanged(workspaceId: string, teamId: string, type: string): void {
    try {
      broadcastAgentTeamsEvent({ workspaceId, teamId, type, timestamp: Date.now() });
    } catch (err) {
      console.warn('[agent-teams] failed to broadcast team event:', err);
    }
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

  private resolveOpenGateForAgent(
    snapshot: RuntimeSnapshot,
    agent: TeamAgentRecord,
    taskId?: string,
  ): RuntimeSnapshot['humanGates'][number] | undefined {
    const openGates = snapshot.humanGates.filter((gate) =>
      gate.status === 'open'
      && gate.agentId === agent.id
    );
    if (openGates.length === 0) return undefined;

    // An explicit task pins the answer to that task's gate, disambiguating when
    // a teammate has several open questions across different tasks.
    if (taskId) {
      return openGates.find((gate) => gate.taskId === taskId);
    }

    if (agent.currentTaskId) {
      const currentTaskGate = openGates.find((gate) => gate.taskId === agent.currentTaskId);
      if (currentTaskGate) return currentTaskGate;
    }

    const needsInputTaskIds = new Set(
      snapshot.tasks
        .filter((task) => task.ownerAgentId === agent.id && task.status === 'needs_input')
        .map((task) => task.id),
    );
    const needsInputGates = openGates.filter((gate) => gate.taskId && needsInputTaskIds.has(gate.taskId));
    if (needsInputGates.length === 1) return needsInputGates[0];

    return openGates.length === 1 ? openGates[0] : undefined;
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
    workspaceId: string,
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
      this.emitTeamsChanged(workspaceId, agent.teamId, 'plan_proposed');
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
      // Ignore stray human-input markers for a task the Team Lead already closed.
      // Late terminal output (the agent printing the marker after the task was
      // completed/failed) must not resurrect a settled gate into the lead backlog.
      const markerTask = taskId ? snapshot.tasks.find((task) => task.id === taskId) : undefined;
      if (markerTask && (markerTask.status === 'done' || markerTask.status === 'failed')) {
        return false;
      }
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

  private async repairAnsweredHumanGateBlocks(store: CanvasAgentTeamStore, teamId: string): Promise<void> {
    const [gates, tasks, agents] = await Promise.all([
      store.listHumanGates(teamId),
      store.listTasks(teamId),
      store.listAgents(teamId),
    ]);
    const openTaskGateIds = new Set(
      gates
        .filter((gate) => gate.status === 'open' && gate.taskId)
        .map((gate) => gate.taskId as string),
    );
    const answeredTaskGateIds = new Set(
      gates
        .filter((gate) => gate.status === 'answered' && gate.taskId)
        .map((gate) => gate.taskId as string),
    );
    if (answeredTaskGateIds.size === 0) return;

    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const now = Date.now();
    for (const task of tasks) {
      if (
        task.status !== 'needs_input'
        || !answeredTaskGateIds.has(task.id)
        || openTaskGateIds.has(task.id)
      ) {
        continue;
      }

      task.status = task.ownerAgentId ? 'in_progress' : 'todo';
      task.blockedReason = undefined;
      task.updatedAt = now;
      await store.saveTask(task);

      if (!task.ownerAgentId) continue;
      const agent = agentsById.get(task.ownerAgentId);
      if (!agent || agent.status !== 'needs_input' || agent.currentTaskId !== task.id) continue;
      agent.status = 'running';
      agent.updatedAt = now;
      await store.saveAgent(agent);
    }
  }
}

let service: CanvasAgentTeamsService | null = null;

export function getCanvasAgentTeamsService(): CanvasAgentTeamsService {
  if (!service) service = new CanvasAgentTeamsService();
  return service;
}
