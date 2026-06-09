import { randomUUID } from 'node:crypto';
import type {
  AddAgentInput,
  AgentId,
  AgentSessionAdapter,
  AgentStatus,
  CreateArtifactInput,
  CreateTaskInput,
  CreateTeamInput,
  DispatchResult,
  HumanGateId,
  MailboxMessage,
  OpenHumanGateInput,
  RuntimeSnapshot,
  TaskId,
  TaskStatus,
  TeamAgentRecord,
  TeamArtifactRecord,
  TeamEvent,
  TeamEventType,
  TeamId,
  TeamRuntimeStore,
  TeamStatus,
  TeamTaskRecord,
} from './types.js';
import { InMemoryTeamRuntimeStore } from './memory-store.js';
import { assertTaskGraphAcyclic } from './task-graph.js';

export interface TeamRuntimeOptions {
  store?: TeamRuntimeStore;
  agentSessions?: AgentSessionAdapter;
  now?: () => number;
  idFactory?: () => string;
}

type EventHandler = (event: TeamEvent) => void;
const MAX_DEPENDENCY_CONTEXT_CHARS = 6_000;
const MAX_TASK_RESULT_CHARS = 1_600;
const MAX_ARTIFACT_SUMMARY_CHARS = 600;
const TEAM_PAUSE_METADATA_KEY = 'teamPause';
const LEAD_PENDING_DIGEST_RESEND_MS = 30_000;
const LEAD_REVIEW_RESEND_MS = 60_000;
const LEAD_NOTIFICATION_GUARD = [
  'Pulse Canvas team event. Handle this notification once.',
  'Do not run sleep, watch, tail, polling loops, or repeated status checks.',
  'If no immediate action is needed, briefly acknowledge and stop. Pulse Canvas will wake you again for the next required decision.',
].join('\n');

const truncate = (value: string | undefined, maxChars: number): string => {
  if (!value) return '';
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
};

const hasConcreteHumanInputPrompt = (value: string | undefined): value is string => {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalized) return false;
  if (/^agent requested human input\.?$/i.test(normalized)) return false;
  if (/^human input requested\.?$/i.test(normalized)) return false;
  return true;
};

const isLeadAudienceGate = (metadata: Record<string, unknown> | undefined): boolean =>
  metadata?.audience === 'lead';

const quoteCliValue = (value: string): string =>
  value.replace(/(["\\$`])/g, '\\$1');

const TASK_ROUND_METADATA_KEY = 'round';
const TEAM_CURRENT_ROUND_METADATA_KEY = 'currentRound';

/** Read a task's round from its metadata, defaulting to 1 for legacy/unset tasks. */
const readTaskRound = (metadata: Record<string, unknown> | undefined): number => {
  const value = metadata?.[TASK_ROUND_METADATA_KEY];
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
};

const readCurrentRound = (metadata: Record<string, unknown> | undefined): number => {
  const value = metadata?.[TEAM_CURRENT_ROUND_METADATA_KEY];
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
};

/** Whether the team has been explicitly opted into the round-checkpoint model. */
const hasRoundMetadata = (metadata: Record<string, unknown> | undefined): boolean =>
  metadata?.[TEAM_CURRENT_ROUND_METADATA_KEY] !== undefined;

/**
 * Decide which "round" a new task belongs to.
 *
 * A round groups tasks created in the same wave of work. When every existing task
 * is already finished (done/failed) — e.g. a human adds follow-up work after a
 * completed run — the new task starts the next round so it renders separately from
 * the original plan instead of being merged into it. While any earlier task is still
 * active, new tasks join the current (highest) round. An explicit metadata.round wins.
 */
const resolveTaskRound = (
  existingTasks: TeamTaskRecord[],
  metadata: Record<string, unknown> | undefined,
): number => {
  const provided = metadata?.[TASK_ROUND_METADATA_KEY];
  if (typeof provided === 'number' && Number.isFinite(provided) && provided >= 1) {
    return Math.floor(provided);
  }
  if (existingTasks.length === 0) return 1;
  const maxRound = existingTasks.reduce((max, task) => Math.max(max, readTaskRound(task.metadata)), 1);
  const hasUnfinished = existingTasks.some((task) => task.status !== 'done' && task.status !== 'failed');
  return hasUnfinished ? maxRound : maxRound + 1;
};

interface TeamPauseMetadata {
  pausedAt: number;
  reason: string;
  previousStatus: AgentStatus | TaskStatus;
  previousCurrentTaskId?: TaskId;
  previousBlockedReason?: string;
}

const readTeamPauseMetadata = (metadata: Record<string, unknown> | undefined): TeamPauseMetadata | undefined => {
  const value = metadata?.[TEAM_PAUSE_METADATA_KEY];
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.previousStatus !== 'string') return undefined;
  return {
    pausedAt: typeof candidate.pausedAt === 'number' ? candidate.pausedAt : 0,
    reason: typeof candidate.reason === 'string' ? candidate.reason : '',
    previousStatus: candidate.previousStatus as AgentStatus | TaskStatus,
    previousCurrentTaskId: typeof candidate.previousCurrentTaskId === 'string'
      ? candidate.previousCurrentTaskId
      : undefined,
    previousBlockedReason: typeof candidate.previousBlockedReason === 'string'
      ? candidate.previousBlockedReason
      : undefined,
  };
};

const writeTeamPauseMetadata = (
  metadata: Record<string, unknown> | undefined,
  pause: TeamPauseMetadata,
): Record<string, unknown> => ({
  ...(metadata ?? {}),
  [TEAM_PAUSE_METADATA_KEY]: pause,
});

const clearTeamPauseMetadata = (
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!metadata || !(TEAM_PAUSE_METADATA_KEY in metadata)) return metadata;
  const next = { ...metadata };
  delete next[TEAM_PAUSE_METADATA_KEY];
  return Object.keys(next).length > 0 ? next : undefined;
};

export class TeamRuntime {
  private readonly store: TeamRuntimeStore;
  private readonly agentSessions?: AgentSessionAdapter;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly handlers = new Set<EventHandler>();
  private readonly sessionAgents = new Map<string, AgentId>();
  private readonly leadPendingDigestCache = new Map<TeamId, { digest: string; sentAt: number }>();
  private readonly leadReviewNudgeCache = new Map<TeamId, number>();
  private dispatchPaused = new Set<TeamId>();
  private unsubscribeSessionEvents?: () => void;

  constructor(options: TeamRuntimeOptions = {}) {
    this.store = options.store ?? new InMemoryTeamRuntimeStore();
    this.agentSessions = options.agentSessions;
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? (() => randomUUID());

    if (this.agentSessions?.onEvent) {
      this.unsubscribeSessionEvents = this.agentSessions.onEvent((event) => {
        void this.handleAgentSessionEvent(event);
      });
    }
  }

  dispose(): void {
    this.unsubscribeSessionEvents?.();
    this.handlers.clear();
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async createTeam(input: CreateTeamInput): Promise<RuntimeSnapshot> {
    const now = this.now();
    const team = {
      id: input.id ?? this.idFactory(),
      name: input.name,
      goal: input.goal,
      status: 'planning' as TeamStatus,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };

    await this.store.saveTeam(team);
    await this.emit(team.id, 'team_created', 'runtime', { teamId: team.id });
    return this.snapshot(team.id);
  }

  async addAgent(input: AddAgentInput): Promise<TeamAgentRecord> {
    const team = await this.requireTeam(input.teamId);
    const now = this.now();
    const agent: TeamAgentRecord = {
      id: input.id ?? this.idFactory(),
      teamId: input.teamId,
      role: input.role,
      name: input.name,
      status: 'idle',
      cwd: input.cwd,
      sessionRef: input.sessionRef,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };

    await this.store.saveAgent(agent);
    if (agent.sessionRef) {
      this.sessionAgents.set(agent.sessionRef.sessionId, agent.id);
    }

    if (agent.role === 'lead' && !team.leadAgentId) {
      team.leadAgentId = agent.id;
      team.updatedAt = now;
      await this.store.saveTeam(team);
    }

    await this.emit(agent.teamId, 'agent_added', 'runtime', {
      agentId: agent.id,
      role: agent.role,
    });
    return agent;
  }

  async createAgentSession(agentId: AgentId, prompt?: string): Promise<TeamAgentRecord> {
    if (!this.agentSessions) {
      throw new Error('No AgentSessionAdapter configured');
    }

    const agent = await this.requireAgent(agentId);
    const sessionRef = await this.agentSessions.createSession({
      teamId: agent.teamId,
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      cwd: agent.cwd,
      prompt,
      metadata: agent.metadata,
    });

    agent.sessionRef = sessionRef;
    agent.updatedAt = this.now();
    await this.store.saveAgent(agent);
    this.sessionAgents.set(sessionRef.sessionId, agent.id);
    return agent;
  }

  async createTask(input: CreateTaskInput): Promise<TeamTaskRecord> {
    await this.requireTeam(input.teamId);
    const now = this.now();
    const existingTasks = await this.store.listTasks(input.teamId);
    const round = resolveTaskRound(existingTasks, input.metadata);
    const task: TeamTaskRecord = {
      id: input.id ?? this.idFactory(),
      teamId: input.teamId,
      title: input.title,
      description: input.description,
      status: 'todo',
      ownerAgentId: input.ownerAgentId,
      deps: input.deps ?? [],
      createdBy: input.createdBy ?? 'runtime',
      createdAt: now,
      updatedAt: now,
      metadata: { ...(input.metadata ?? {}), [TASK_ROUND_METADATA_KEY]: round },
    };
    assertTaskGraphAcyclic([...existingTasks, task]);

    await this.store.saveTask(task);
    await this.emit(task.teamId, 'task_created', task.createdBy, {
      taskId: task.id,
      ownerAgentId: task.ownerAgentId,
    });
    return task;
  }

  async setTeamStatus(teamId: TeamId, status: TeamStatus, actor: AgentId | 'human' | 'runtime' = 'runtime'): Promise<void> {
    const team = await this.requireTeam(teamId);
    if (team.status === status) return;
    team.status = status;
    team.updatedAt = this.now();
    await this.store.saveTeam(team);
    await this.emit(teamId, 'team_status_changed', actor, { status });
  }

  async pauseDispatch(teamId: TeamId): Promise<void> {
    this.dispatchPaused.add(teamId);
    await this.setTeamStatus(teamId, 'paused');
    await this.emit(teamId, 'dispatch_paused', 'runtime', {});
  }

  async pauseTeam(teamId: TeamId, reason = 'Paused by user.'): Promise<void> {
    await this.requireTeam(teamId);
    this.dispatchPaused.add(teamId);
    const now = this.now();
    const [agents, tasks, humanGates] = await Promise.all([
      this.store.listAgents(teamId),
      this.store.listTasks(teamId),
      this.store.listHumanGates(teamId),
    ]);

    for (const agent of agents) {
      if (agent.status === 'done' || agent.status === 'error' || agent.status === 'stopped') continue;
      if (this.agentSessions && agent.sessionRef) {
        try {
          await this.agentSessions.interrupt(agent.sessionRef.sessionId, 'abort');
        } catch {
          // Best effort: the stored runtime state still needs to stop even if the backing session is gone.
        }
      }
      await this.appendMessage({
        teamId,
        from: 'human',
        to: agent.id,
        type: 'interrupt',
        content: reason,
        taskId: agent.currentTaskId,
        metadata: { mode: 'abort', scope: 'team' },
      });
      agent.metadata = writeTeamPauseMetadata(agent.metadata, {
        pausedAt: now,
        reason,
        previousStatus: agent.status,
        previousCurrentTaskId: agent.currentTaskId,
      });
      agent.status = 'stopped';
      agent.currentTaskId = undefined;
      agent.updatedAt = now;
      await this.store.saveAgent(agent);
    }

    for (const task of tasks) {
      if (task.status !== 'in_progress' && task.status !== 'needs_input' && task.status !== 'needs_review') continue;
      task.metadata = writeTeamPauseMetadata(task.metadata, {
        pausedAt: now,
        reason,
        previousStatus: task.status,
        previousBlockedReason: task.blockedReason,
      });
      task.status = 'blocked';
      task.blockedReason = reason;
      task.updatedAt = now;
      await this.store.saveTask(task);
    }

    for (const gate of humanGates) {
      if (gate.status !== 'open') continue;
      gate.status = 'cancelled';
      gate.updatedAt = now;
      await this.store.saveHumanGate(gate);
    }

    await this.setTeamStatus(teamId, 'paused', 'human');
    await this.emit(teamId, 'dispatch_paused', 'human', { reason, scope: 'team' });
  }

  async resumeTeam(teamId: TeamId, reason = 'Resumed by user.'): Promise<void> {
    const teamForResume = await this.requireTeam(teamId);
    if (teamForResume.status === 'round_checkpoint') {
      await this.advanceRound(teamId, 'human');
      return;
    }
    this.dispatchPaused.delete(teamId);
    const now = this.now();
    const [agents, tasks] = await Promise.all([
      this.store.listAgents(teamId),
      this.store.listTasks(teamId),
    ]);
    let restoredAgents = 0;
    let restoredTasks = 0;

    for (const agent of agents) {
      const pause = readTeamPauseMetadata(agent.metadata);
      if (!pause) continue;
      agent.metadata = clearTeamPauseMetadata(agent.metadata);
      if (agent.status === 'stopped') {
        agent.status = 'idle';
        agent.currentTaskId = undefined;
      }
      agent.updatedAt = now;
      restoredAgents += 1;
      await this.store.saveAgent(agent);
    }

    for (const task of tasks) {
      const pause = readTeamPauseMetadata(task.metadata);
      if (!pause) continue;
      task.metadata = clearTeamPauseMetadata(task.metadata);
      if (task.status === 'blocked' && task.blockedReason === pause.reason) {
        task.status = pause.previousStatus === 'needs_review' ? 'needs_review' : 'todo';
        task.blockedReason = pause.previousBlockedReason;
      }
      task.updatedAt = now;
      restoredTasks += 1;
      await this.store.saveTask(task);
    }

    await this.setTeamStatus(teamId, 'running', 'human');
    await this.emit(teamId, 'dispatch_resumed', 'human', {
      reason,
      scope: 'team',
      restoredAgents,
      restoredTasks,
    });
  }

  async resumeDispatch(teamId: TeamId): Promise<void> {
    this.dispatchPaused.delete(teamId);
    await this.setTeamStatus(teamId, 'running');
    await this.emit(teamId, 'dispatch_resumed', 'runtime', {});
  }

  async advanceRound(teamId: TeamId, actor: AgentId | 'human' | 'runtime' = 'human'): Promise<void> {
    const team = await this.requireTeam(teamId);
    if (team.status !== 'round_checkpoint') {
      throw new Error(`Cannot advance round: team status is '${team.status}', expected 'round_checkpoint'`);
    }
    const currentRound = readCurrentRound(team.metadata);
    const nextRound = currentRound + 1;
    team.metadata = {
      ...(team.metadata ?? {}),
      [TEAM_CURRENT_ROUND_METADATA_KEY]: nextRound,
    };
    team.updatedAt = this.now();
    await this.store.saveTeam(team);

    await this.setTeamStatus(teamId, 'running', actor);
    await this.emit(teamId, 'round_advanced', actor, {
      previousRound: currentRound,
      currentRound: nextRound,
    });
    await this.notifyLeadRoundAdvanced(teamId, currentRound, nextRound);
  }

  async finalizeFromCheckpoint(teamId: TeamId, actor: AgentId | 'human' | 'runtime' = 'human'): Promise<void> {
    const team = await this.requireTeam(teamId);
    if (team.status !== 'round_checkpoint') {
      throw new Error(`Cannot finalize: team status is '${team.status}', expected 'round_checkpoint'`);
    }
    await this.setTeamStatus(teamId, 'reviewing', actor);
    await this.sendFinalReviewPrompt(teamId);
  }

  async initializeRound(teamId: TeamId): Promise<void> {
    const team = await this.requireTeam(teamId);
    if (hasRoundMetadata(team.metadata)) return;
    team.metadata = {
      ...(team.metadata ?? {}),
      [TEAM_CURRENT_ROUND_METADATA_KEY]: 1,
    };
    team.updatedAt = this.now();
    await this.store.saveTeam(team);
  }

  async repairCurrentRound(teamId: TeamId): Promise<boolean> {
    const team = await this.requireTeam(teamId);
    if (!hasRoundMetadata(team.metadata)) return false;
    const currentRound = readCurrentRound(team.metadata);
    const tasks = await this.store.listTasks(teamId);
    const todoRounds = tasks
      .filter((t) => t.status === 'todo')
      .map((t) => readTaskRound(t.metadata));
    if (todoRounds.length === 0) return false;
    const maxTodoRound = Math.max(...todoRounds);
    if (maxTodoRound <= currentRound) return false;
    team.metadata = {
      ...(team.metadata ?? {}),
      [TEAM_CURRENT_ROUND_METADATA_KEY]: maxTodoRound,
    };
    team.updatedAt = this.now();
    await this.store.saveTeam(team);
    return true;
  }

  async updateTaskDescription(taskId: TaskId, patch: { title?: string; description?: string }): Promise<TeamTaskRecord> {
    const task = await this.requireTask(taskId);
    if (task.status !== 'todo') {
      throw new Error(`Cannot edit task in status '${task.status}'`);
    }
    if (patch.title) task.title = patch.title;
    if (patch.description) task.description = patch.description;
    task.updatedAt = this.now();
    await this.store.saveTask(task);
    return task;
  }

  async deleteTeam(teamId: TeamId): Promise<void> {
    const snapshot = await this.snapshot(teamId);
    for (const agent of snapshot.agents) {
      if (!this.agentSessions || !agent.sessionRef) continue;
      try {
        await this.agentSessions.interrupt(agent.sessionRef.sessionId, 'abort');
      } catch {
        // Deletion should not be blocked by a stale or already-dead session.
      }
    }
    this.dispatchPaused.delete(teamId);
    await this.store.deleteTeam(teamId);
  }

  async dispatchReadyTasks(teamId: TeamId): Promise<DispatchResult> {
    const team = await this.requireTeam(teamId);
    if (
      this.dispatchPaused.has(teamId)
      || team.status === 'paused'
      || team.status === 'waiting_approval'
      || team.status === 'round_checkpoint'
    ) {
      return { assigned: [], idleAgents: [] };
    }

    const tasks = await this.store.listTasks(teamId);
    const agents = await this.store.listAgents(teamId);
    const idleAgents = agents.filter(agent => agent.status === 'idle' && !agent.currentTaskId);
    const roundEnabled = hasRoundMetadata(team.metadata);
    const currentRound = readCurrentRound(team.metadata);
    const readyTasks = tasks.filter(task =>
      task.status === 'todo'
      && this.isTaskReady(task, tasks)
      && (!roundEnabled || readTaskRound(task.metadata) === currentRound)
    );
    const assigned: TeamTaskRecord[] = [];
    const availableAgents = [...idleAgents];

    for (const task of readyTasks) {
      const owner = task.ownerAgentId
        ? availableAgents.find(agent => agent.id === task.ownerAgentId)
        : availableAgents.find(agent => agent.role === 'teammate');
      if (!owner) continue;

      availableAgents.splice(availableAgents.indexOf(owner), 1);
      task.status = 'in_progress';
      task.ownerAgentId = owner.id;
      task.updatedAt = this.now();
      owner.status = 'running';
      owner.currentTaskId = task.id;
      owner.updatedAt = this.now();

      await this.store.saveTask(task);
      await this.store.saveAgent(owner);
      await this.appendMessage({
        teamId,
        from: 'runtime',
        to: owner.id,
        type: 'task_assigned',
        content: task.description,
        taskId: task.id,
      });
      await this.emit(teamId, 'task_assigned', 'runtime', {
        taskId: task.id,
        agentId: owner.id,
      });

      if (this.agentSessions && owner.sessionRef) {
        const taskPrompt = await this.formatTaskPrompt(task, tasks, owner);
        await this.agentSessions.sendInput(owner.sessionRef.sessionId, taskPrompt);
        // Record this as the agent's current launch prompt so a later restart
        // replays THIS task rather than a previously finished one.
        await this.agentSessions.persistLaunchPrompt?.(owner.sessionRef.sessionId, taskPrompt);
      }

      assigned.push({ ...task });
    }

    if (team.status !== 'running' && assigned.length > 0) {
      await this.setTeamStatus(teamId, 'running');
    }

    return { assigned, idleAgents: availableAgents };
  }

  async completeTask(taskId: TaskId, result: string, actor?: AgentId | 'human' | 'runtime'): Promise<TeamTaskRecord> {
    const task = await this.requireTask(taskId);
    task.status = 'done';
    task.result = result;
    task.updatedAt = this.now();
    await this.store.saveTask(task);
    await this.cancelOpenGatesForTask(task.teamId, task.id);

    if (task.ownerAgentId) {
      const agent = await this.store.getAgent(task.ownerAgentId);
      if (agent?.currentTaskId === task.id) {
        agent.currentTaskId = undefined;
        agent.status = 'idle';
        agent.updatedAt = this.now();
        await this.store.saveAgent(agent);
      }
    }

    await this.appendMessage({
      teamId: task.teamId,
      from: actor ?? task.ownerAgentId ?? 'runtime',
      to: 'lead',
      type: 'task_completed',
      content: result,
      taskId: task.id,
    });
    await this.emit(task.teamId, 'task_completed', actor ?? task.ownerAgentId ?? 'runtime', {
      taskId: task.id,
    });

    await this.checkRoundCompletion(task.teamId);
    return task;
  }

  async requestTaskReview(taskId: TaskId, reason: string, actor?: AgentId | 'runtime'): Promise<TeamTaskRecord> {
    const task = await this.requireTask(taskId);
    if (task.status === 'done' || task.status === 'failed') return task;
    task.status = 'needs_review';
    task.blockedReason = reason;
    task.updatedAt = this.now();
    await this.store.saveTask(task);

    if (task.ownerAgentId) {
      const agent = await this.store.getAgent(task.ownerAgentId);
      if (agent?.currentTaskId === task.id) {
        agent.currentTaskId = undefined;
        agent.status = 'idle';
        agent.updatedAt = this.now();
        await this.store.saveAgent(agent);
      }
    }

    await this.appendMessage({
      teamId: task.teamId,
      from: actor ?? task.ownerAgentId ?? 'runtime',
      to: 'lead',
      type: 'status_update',
      content: reason,
      taskId: task.id,
      metadata: { status: 'needs_review' },
    });
    await this.emit(task.teamId, 'task_needs_review', actor ?? task.ownerAgentId ?? 'runtime', {
      taskId: task.id,
      reason,
    });
    await this.notifyLead(task.teamId, await this.formatTaskReviewPrompt(task, reason), task.id);
    return task;
  }

  async failTask(taskId: TaskId, error: string, actor?: AgentId | 'runtime'): Promise<TeamTaskRecord> {
    const task = await this.requireTask(taskId);
    task.status = 'failed';
    task.result = error;
    task.updatedAt = this.now();
    await this.store.saveTask(task);
    await this.cancelOpenGatesForTask(task.teamId, task.id);

    if (task.ownerAgentId) {
      const agent = await this.store.getAgent(task.ownerAgentId);
      if (agent?.currentTaskId === task.id) {
        agent.currentTaskId = undefined;
        agent.status = 'error';
        agent.updatedAt = this.now();
        await this.store.saveAgent(agent);
      }
    }

    await this.emit(task.teamId, 'task_failed', actor ?? task.ownerAgentId ?? 'runtime', {
      taskId: task.id,
      error,
    });
    await this.notifyLead(task.teamId, [
      `Task failed: ${task.title}`,
      '',
      error,
      '',
      'Review the failure. You may create follow-up tasks with:',
      'pulse-canvas team create-task --title "..." --description "..." --owner "..." --dispatch',
    ].join('\n'), task.id);
    await this.checkRoundCompletion(task.teamId);
    return task;
  }

  async blockTask(taskId: TaskId, reason: string, actor?: AgentId | 'runtime'): Promise<TeamTaskRecord> {
    const task = await this.requireTask(taskId);
    task.status = 'blocked';
    task.blockedReason = reason;
    task.updatedAt = this.now();
    await this.store.saveTask(task);

    if (task.ownerAgentId) {
      const agent = await this.store.getAgent(task.ownerAgentId);
      if (agent?.currentTaskId === task.id) {
        agent.status = 'blocked';
        agent.updatedAt = this.now();
        await this.store.saveAgent(agent);
      }
    }

    await this.appendMessage({
      teamId: task.teamId,
      from: actor ?? task.ownerAgentId ?? 'runtime',
      to: 'lead',
      type: 'task_blocked',
      content: reason,
      taskId: task.id,
    });
    await this.emit(task.teamId, 'task_blocked', actor ?? task.ownerAgentId ?? 'runtime', {
      taskId: task.id,
      reason,
    });
    await this.notifyLead(task.teamId, [
      `Task blocked: ${task.title}`,
      '',
      reason,
      '',
      'Decide whether to answer, create a follow-up task, or ask the user for input.',
    ].join('\n'), task.id);
    return task;
  }

  async openHumanGate(input: OpenHumanGateInput): Promise<HumanGateId> {
    await this.requireTeam(input.teamId);
    const now = this.now();
    const task = input.taskId ? await this.store.getTask(input.taskId) : undefined;
    const taskFinished = task?.status === 'done' || task?.status === 'failed';
    const gate = {
      id: input.id ?? this.idFactory(),
      teamId: input.teamId,
      taskId: input.taskId,
      agentId: input.agentId,
      reason: input.reason,
      prompt: input.prompt,
      status: (taskFinished ? 'cancelled' : 'open') as 'cancelled' | 'open',
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };

    await this.store.saveHumanGate(gate);

    // A task that already finished must never reopen the Team Lead backlog. The
    // gate is recorded as cancelled for auditability, but we skip the task/agent
    // transitions, the mailbox question, and the lead notification that an open
    // gate would otherwise trigger — those would re-wake the lead about settled
    // work (a stray late marker, a question that arrived after the lead closed
    // the task, etc.).
    if (taskFinished) {
      return gate.id;
    }

    if (task && task.status !== 'done' && task.status !== 'failed') {
      task.status = 'needs_input';
      task.blockedReason = input.reason;
      task.updatedAt = now;
      await this.store.saveTask(task);
    }

    let requestingAgent: TeamAgentRecord | undefined;
    if (input.agentId) {
      const agent = await this.store.getAgent(input.agentId);
      if (agent) {
        requestingAgent = agent;
        agent.status = 'needs_input';
        agent.updatedAt = now;
        await this.store.saveAgent(agent);
      }
    }

    await this.appendMessage({
      teamId: input.teamId,
      from: input.agentId ?? 'runtime',
      to: 'lead',
      type: 'question',
      content: input.prompt,
      taskId: input.taskId,
    });
    await this.emit(input.teamId, 'human_gate_opened', input.agentId ?? 'runtime', {
      gateId: gate.id,
      taskId: input.taskId,
      agentId: input.agentId,
    });
    const leadAudience = isLeadAudienceGate(input.metadata);
    await this.notifyLead(input.teamId, leadAudience
      ? [
        'A teammate needs Team Lead input before continuing.',
        '',
        input.prompt,
        '',
        input.taskId ? `Task ID: ${input.taskId}` : '',
        '',
        'If you can answer, send guidance to the teammate:',
        `pulse-canvas team send --to "${requestingAgent?.name ?? 'Teammate name'}"${input.taskId ? ` --task "${input.taskId}"` : ''} --message "<answer or decision>"`,
        '',
        'Ask the human only if this requires owner input:',
        `pulse-canvas team request-human-input${input.taskId ? ` --task "${input.taskId}"` : ''} --prompt "<specific question>"`,
      ].filter(Boolean).join('\n')
      : [
        'A teammate requested input.',
        '',
        input.prompt,
        '',
        input.taskId ? `Task ID: ${input.taskId}` : '',
      ].filter(Boolean).join('\n'), input.taskId);
    return gate.id;
  }

  async answerHumanGate(gateId: HumanGateId, answer: string): Promise<void> {
    const gate = await this.requireHumanGate(gateId);
    gate.status = 'answered';
    gate.answer = answer;
    gate.updatedAt = this.now();
    await this.store.saveHumanGate(gate);

    await this.appendMessage({
      teamId: gate.teamId,
      from: 'human',
      to: gate.agentId ?? 'lead',
      type: 'answer',
      content: answer,
      taskId: gate.taskId,
    });

    if (gate.agentId) {
      const agent = await this.store.getAgent(gate.agentId);
      if (agent) {
        agent.status = agent.currentTaskId ? 'running' : 'idle';
        agent.updatedAt = this.now();
        await this.store.saveAgent(agent);

        if (this.agentSessions && agent.sessionRef) {
          await this.agentSessions.sendInput(agent.sessionRef.sessionId, answer);
        }
      }
    }

    if (gate.taskId) {
      const task = await this.store.getTask(gate.taskId);
      if (task && task.status === 'needs_input') {
        task.status = task.ownerAgentId ? 'in_progress' : 'todo';
        task.blockedReason = undefined;
        task.updatedAt = this.now();
        await this.store.saveTask(task);
      }
    }

    await this.emit(gate.teamId, 'human_gate_answered', 'human', {
      gateId,
      taskId: gate.taskId,
      agentId: gate.agentId,
    });
  }

  async sendToAgent(agentId: AgentId, content: string, taskId?: TaskId): Promise<void> {
    const agent = await this.requireAgent(agentId);
    const openGate = await this.findOpenGateForAgent(agent, taskId);
    if (openGate) {
      await this.answerHumanGate(openGate.id, content);
      return;
    }

    await this.appendMessage({
      teamId: agent.teamId,
      from: 'human',
      to: agent.id,
      type: 'answer',
      content,
      taskId,
    });
    await this.emit(agent.teamId, 'message_sent', 'human', {
      agentId: agent.id,
      taskId,
    });

    if (this.agentSessions && agent.sessionRef) {
      await this.agentSessions.sendInput(agent.sessionRef.sessionId, content);
    }
  }

  async interruptAgent(agentId: AgentId, mode: 'soft' | 'ctrl-c' | 'abort', reason?: string): Promise<void> {
    const agent = await this.requireAgent(agentId);
    await this.appendMessage({
      teamId: agent.teamId,
      from: 'human',
      to: agent.id,
      type: 'interrupt',
      content: reason ?? `Interrupt requested (${mode})`,
      taskId: agent.currentTaskId,
      metadata: { mode },
    });

    agent.status = 'needs_input';
    agent.updatedAt = this.now();
    await this.store.saveAgent(agent);

    if (this.agentSessions && agent.sessionRef) {
      await this.agentSessions.interrupt(agent.sessionRef.sessionId, mode);
    }

    await this.emit(agent.teamId, 'message_sent', 'human', {
      agentId: agent.id,
      type: 'interrupt',
      mode,
    });
  }

  async createArtifact(input: CreateArtifactInput): Promise<TeamArtifactRecord> {
    await this.requireTeam(input.teamId);
    const artifact: TeamArtifactRecord = {
      id: input.id ?? this.idFactory(),
      teamId: input.teamId,
      taskId: input.taskId,
      agentId: input.agentId,
      kind: input.kind,
      title: input.title,
      uri: input.uri,
      summary: input.summary,
      createdAt: this.now(),
      metadata: input.metadata,
    };

    await this.store.saveArtifact(artifact);
    await this.appendMessage({
      teamId: input.teamId,
      from: input.agentId ?? 'runtime',
      to: 'lead',
      type: 'artifact_created',
      content: input.summary ?? input.title,
      taskId: input.taskId,
      metadata: { artifactId: artifact.id, kind: artifact.kind },
    });
    await this.emit(input.teamId, 'artifact_created', input.agentId ?? 'runtime', {
      artifactId: artifact.id,
      taskId: artifact.taskId,
      kind: artifact.kind,
    });
    return artifact;
  }

  async completeTeam(teamId: TeamId, summary: string, actor: AgentId | 'human' | 'runtime' = 'runtime'): Promise<void> {
    await this.setTeamStatus(teamId, 'completed', actor);
    await this.appendMessage({
      teamId,
      from: actor,
      to: 'all',
      type: 'status_update',
      content: summary,
      metadata: { status: 'completed' },
    });
  }

  async notifyLeadPendingGates(teamId: TeamId): Promise<void> {
    const pendingGateDigest = await this.formatLeadPendingGateDigest(teamId);
    if (!pendingGateDigest) {
      this.leadPendingDigestCache.delete(teamId);
      return;
    }
    const cached = this.leadPendingDigestCache.get(teamId);
    if (
      cached?.digest === pendingGateDigest
      && this.now() - cached.sentAt < LEAD_PENDING_DIGEST_RESEND_MS
    ) {
      return;
    }
    await this.notifyLead(teamId, [
      'Pulse Canvas found teammate questions still waiting for Team Lead attention.',
      '',
      'Handle each one you can answer. Ask the human only when owner input is truly required.',
    ].join('\n'));
  }

  async notifyLeadPlanApproved(teamId: TeamId): Promise<void> {
    const snapshot = await this.snapshot(teamId);
    const taskLines = snapshot.tasks.map((task) => {
      const owner = task.ownerAgentId
        ? snapshot.agents.find((a) => a.id === task.ownerAgentId)?.name ?? 'unassigned'
        : 'unassigned';
      return `- ${task.title} → ${owner} [${task.status}]`;
    });
    await this.notifyLead(teamId, [
      'The user has approved your plan. Tasks are being dispatched to teammates.',
      '',
      'Your role now: monitor progress, answer teammate questions, handle blocked tasks,',
      'and create follow-up tasks if needed.',
      '',
      'Tasks:',
      ...taskLines,
      '',
      'When a teammate finishes or gets stuck, you will be notified automatically.',
    ].join('\n'));
  }

  /**
   * Re-drive a Team Lead that is sitting on a finished team.
   *
   * When every task settles, `markTeamReadyForReviewIfDone` flips the team to
   * `reviewing` and sends the lead one "run complete-team" prompt. That prompt is
   * fire-and-forget: if the lead's session had already exited, it is only queued,
   * and nothing else nudges the lead to finalize — so the team can sit in
   * `reviewing` indefinitely while the UI still shows it executing.
   *
   * Pulse Canvas calls this on its snapshot heartbeat, alongside the pending-gate
   * resend. We re-send the final-review prompt, throttled, until the lead actually
   * completes the team. Re-sending also flips the lead back to `running` and
   * re-queues its launch prompt, which lets the canvas auto-resume relaunch a lead
   * whose session had exited.
   */
  async notifyLeadReviewIfStalled(teamId: TeamId): Promise<void> {
    const team = await this.requireTeam(teamId);
    if (team.status !== 'reviewing') {
      this.leadReviewNudgeCache.delete(teamId);
      return;
    }
    // If teammate questions are still waiting on the lead, the pending-gate digest
    // path is already re-engaging it; don't stack a second prompt on this tick.
    if (await this.formatLeadPendingGateDigest(teamId)) return;
    const lastNudgedAt = this.leadReviewNudgeCache.get(teamId);
    if (lastNudgedAt !== undefined && this.now() - lastNudgedAt < LEAD_REVIEW_RESEND_MS) {
      return;
    }
    await this.sendFinalReviewPrompt(teamId);
  }

  async snapshot(teamId: TeamId): Promise<RuntimeSnapshot> {
    const team = await this.requireTeam(teamId);
    const [agents, tasks, artifacts, humanGates, events, messages] = await Promise.all([
      this.store.listAgents(teamId),
      this.store.listTasks(teamId),
      this.store.listArtifacts(teamId),
      this.store.listHumanGates(teamId),
      this.store.listEvents(teamId),
      this.store.listMessages(teamId),
    ]);

    return {
      team, agents, tasks, artifacts, humanGates, events, messages,
      checkpointRound: team.status === 'round_checkpoint' ? readCurrentRound(team.metadata) : undefined,
    };
  }

  private async handleAgentSessionEvent(event: { sessionId: string; type: string; text?: string; taskId?: string; error?: string }): Promise<void> {
    // Session events are intentionally best-effort. Canvas can feed richer
    // parsed events later; the runtime only updates records it can identify.
    const teams = await this.findTeamsBySession(event.sessionId);
    for (const { agent } of teams) {
      const currentTaskId = event.taskId ?? agent.currentTaskId;
      if (event.type === 'idle') {
        agent.status = 'idle';
        agent.currentTaskId = undefined;
      } else if (event.type === 'needs_input') {
        if (hasConcreteHumanInputPrompt(event.text)) {
          agent.status = 'needs_input';
          await this.openHumanGate({
            teamId: agent.teamId,
            agentId: agent.id,
            taskId: currentTaskId,
            reason: agent.role === 'lead' ? 'Agent requested human input' : 'Teammate requested Team Lead input',
            prompt: event.text,
            metadata: agent.role === 'lead' ? undefined : { audience: 'lead' },
          });
        } else if (currentTaskId) {
          await this.requestTaskReview(
            currentTaskId,
            'Agent requested human input but did not include a concrete question.',
            agent.id,
          );
          continue;
        } else {
          agent.status = 'idle';
          agent.currentTaskId = undefined;
        }
      } else if (event.type === 'failed') {
        if (currentTaskId) {
          await this.requestTaskReview(
            currentTaskId,
            event.error || 'Agent session failed before reporting task completion.',
            agent.id,
          );
          continue;
        }
        agent.status = 'error';
      } else if (event.type === 'completed') {
        if (currentTaskId) {
          await this.requestTaskReview(
            currentTaskId,
            event.text || 'Agent session completed before reporting task completion.',
            agent.id,
          );
          continue;
        }
        agent.status = 'idle';
      } else if (event.type === 'stopped') {
        if (currentTaskId) {
          await this.requestTaskReview(
            currentTaskId,
            event.text || 'Agent session stopped before reporting task completion.',
            agent.id,
          );
          continue;
        }
        agent.status = 'stopped';
      }
      agent.updatedAt = this.now();
      await this.store.saveAgent(agent);
    }
  }

  private async findTeamsBySession(sessionId: string): Promise<Array<{ agent: TeamAgentRecord }>> {
    const agentId = this.sessionAgents.get(sessionId);
    if (!agentId) return [];
    const agent = await this.store.getAgent(agentId);
    return agent ? [{ agent }] : [];
  }

  private isTaskReady(task: TeamTaskRecord, tasks: TeamTaskRecord[]): boolean {
    return task.deps.every(depId => tasks.find(candidate => candidate.id === depId)?.status === 'done');
  }

  private async formatTaskPrompt(task: TeamTaskRecord, tasks: TeamTaskRecord[], owner?: TeamAgentRecord): Promise<string> {
    const dependencyContext = await this.formatDependencyContext(task, tasks);
    const downstreamTasks = tasks
      .filter(candidate => candidate.id !== task.id && candidate.deps.includes(task.id))
      .slice(0, 8);
    return [
      `You are assigned a team task: ${task.title}`,
      '',
      task.description,
      ...(owner?.cwd
        ? [
          '',
          `Working directory: ${owner.cwd}`,
          'Run terminal commands from this directory unless the task explicitly requires a different path.',
        ]
        : []),
      '',
      'Scope boundary:',
      'Only complete the assigned task above. Do not implement downstream, sibling, QA, documentation, integration, or final-summary tasks unless this task description explicitly asks for that work.',
      'If this task is a survey, analysis, contract, architecture, or planning task, produce the requested findings/contract/artifact and stop. Do not start implementing runtime, host app, child apps, tests, or docs that belong to later tasks.',
      'Use dependency context as read-only background. If you discover extra work, mention it in your completion summary or ask the Team Lead; do not silently expand scope.',
      ...(downstreamTasks.length > 0
        ? [
          '',
          'Downstream tasks that are not yours yet:',
          ...downstreamTasks.map(candidate => `- ${candidate.title}`),
          'Leave those tasks for their assigned teammates after this task is completed.',
        ]
        : []),
      '',
      ...(dependencyContext
        ? [
          'Dependency context from completed upstream tasks:',
          dependencyContext,
          '',
        ]
        : []),
      `Task ID: ${task.id}`,
      'When finished, run this command from the terminal. Do not merely print it:',
      `pulse-canvas team complete-task --task "${task.id}" --summary "<short summary>"`,
      '',
      'If you need human input, prefer:',
      `pulse-canvas team request-human-input --task "${task.id}" --prompt "<question>"`,
      'Teammate questions are routed to the Team Lead first. The Team Lead asks the human only if needed.',
      'Fallback marker:',
      `[agent-team:human-input-needed taskId="${task.id}"] <question>`,
      '',
      'If you are blocked without a human answer, run this command from the terminal. Do not merely print it:',
      `pulse-canvas team block-task --task "${task.id}" --reason "<reason>"`,
      '',
      'If you create a notable artifact, prefer:',
      `pulse-canvas team publish-artifact --task "${task.id}" --kind "diff" --title "filename.diff" --summary "<short summary>"`,
      'Fallback marker:',
      `[agent-team:artifact taskId="${task.id}" kind="diff" title="filename.diff"] <short summary>`,
    ].join('\n');
  }

  private async formatDependencyContext(task: TeamTaskRecord, tasks: TeamTaskRecord[]): Promise<string> {
    if (task.deps.length === 0) return '';
    const byId = new Map(tasks.map(candidate => [candidate.id, candidate]));
    const dependencyTasks = this.collectDependencyTasks(task, byId)
      .filter(dep => dep.status === 'done' || dep.status === 'failed');
    if (dependencyTasks.length === 0) return '';

    const artifacts = await this.store.listArtifacts(task.teamId);
    const lines: string[] = [];
    for (const dep of dependencyTasks) {
      lines.push(`- ${dep.title} [${dep.status}]`);
      if (dep.result) {
        lines.push(`  Result: ${truncate(dep.result, MAX_TASK_RESULT_CHARS)}`);
      }
      const depArtifacts = artifacts.filter(artifact => artifact.taskId === dep.id);
      for (const artifact of depArtifacts) {
        const summary = truncate(artifact.summary || artifact.uri || '', MAX_ARTIFACT_SUMMARY_CHARS);
        lines.push(`  Artifact: ${artifact.title} (${artifact.kind})${summary ? ` - ${summary}` : ''}`);
      }
    }

    return truncate(lines.join('\n'), MAX_DEPENDENCY_CONTEXT_CHARS);
  }

  private collectDependencyTasks(
    task: TeamTaskRecord,
    byId: Map<TaskId, TeamTaskRecord>,
    seen = new Set<TaskId>(),
  ): TeamTaskRecord[] {
    const collected: TeamTaskRecord[] = [];
    for (const depId of task.deps) {
      if (seen.has(depId)) continue;
      seen.add(depId);
      const dep = byId.get(depId);
      if (!dep) continue;
      collected.push(...this.collectDependencyTasks(dep, byId, seen));
      collected.push(dep);
    }
    return collected;
  }

  private async checkRoundCompletion(teamId: TeamId): Promise<void> {
    const team = await this.requireTeam(teamId);

    if (!hasRoundMetadata(team.metadata)) {
      await this.markTeamReadyForReviewIfDone(teamId);
      return;
    }

    if (team.status !== 'running') return;

    const tasks = await this.store.listTasks(teamId);
    if (tasks.length === 0) return;

    const currentRound = readCurrentRound(team.metadata);
    const currentRoundTasks = tasks.filter((t) => readTaskRound(t.metadata) === currentRound);

    if (currentRoundTasks.length === 0 || !currentRoundTasks.every((t) => t.status === 'done' || t.status === 'failed')) {
      return;
    }

    await this.setTeamStatus(teamId, 'round_checkpoint');
    await this.emit(teamId, 'round_checkpoint_entered', 'runtime', {
      completedRound: currentRound,
    });
  }

  private async markTeamReadyForReviewIfDone(teamId: TeamId): Promise<void> {
    const tasks = await this.store.listTasks(teamId);
    if (tasks.length === 0) return;
    if (tasks.every(task => task.status === 'done' || task.status === 'failed')) {
      await this.setTeamStatus(teamId, tasks.some(task => task.status === 'failed') ? 'failed' : 'reviewing');
      await this.sendFinalReviewPrompt(teamId);
    }
  }

  /**
   * Notify the Team Lead that all dispatched work is finished, and record when
   * the nudge was sent. The recorded time throttles the heartbeat re-nudge
   * (`notifyLeadReviewIfStalled`) so a lead that already saw this prompt is not
   * spammed, while a lead that never acted still gets driven again later.
   */
  private async notifyLeadRoundAdvanced(teamId: TeamId, completedRound: number, nextRound: number): Promise<void> {
    const snapshot = await this.snapshot(teamId);
    const completedTasks = snapshot.tasks
      .filter((t) => readTaskRound(t.metadata) === completedRound)
      .map((t) => `- ${t.title}: ${t.status}${t.result ? ` — ${truncate(t.result, 220)}` : ''}`);
    const artifactLines = snapshot.artifacts.map((a) =>
      `- ${a.title} (${a.kind})${a.summary ? ` — ${truncate(a.summary, 180)}` : ''}`,
    );
    const existingTeammates = snapshot.agents
      .filter((a) => a.role === 'teammate')
      .map((a) => `- ${a.name} (${a.status})`);

    await this.notifyLead(teamId, [
      `Round ${completedRound} is complete. The user wants to continue with Round ${nextRound}.`,
      '',
      `Round ${completedRound} results:`,
      ...completedTasks,
      ...(artifactLines.length > 0 ? ['', 'Artifacts:', ...artifactLines] : []),
      '',
      ...(existingTeammates.length > 0
        ? [
            'IMPORTANT: Reuse existing teammates by their exact names when assigning tasks.',
            'Do NOT create new teammate names — use the ones below:',
            ...existingTeammates,
            '',
          ]
        : []),
      `Plan the next round of work. Review what was accomplished and create new tasks for Round ${nextRound}:`,
      'pulse-canvas team create-task --title "..." --description "..." --owner "..." --dispatch',
      '',
      'When you have created all tasks for this round, they will be dispatched automatically.',
      'If no more work is needed, run:',
      'pulse-canvas team complete-team --summary "<final summary>"',
    ].join('\n'));
  }

  private async sendFinalReviewPrompt(teamId: TeamId): Promise<void> {
    await this.notifyLead(teamId, await this.formatFinalReviewPrompt(teamId));
    this.leadReviewNudgeCache.set(teamId, this.now());
  }

  private async formatTaskReviewPrompt(task: TeamTaskRecord, reason: string): Promise<string> {
    const tasks = await this.store.listTasks(task.teamId);
    const downstreamTasks = tasks
      .filter(candidate => candidate.id !== task.id && candidate.deps.includes(task.id))
      .slice(0, 8);
    const downstreamLines = downstreamTasks.map(candidate =>
      `- ${candidate.title} [${candidate.status}] ID: ${candidate.id}`,
    );

    return [
      `Task needs review: ${task.title}`,
      '',
      reason,
      '',
      `Task ID: ${task.id}`,
      '',
      'If it is complete, run:',
      `pulse-canvas team complete-task --task "${task.id}" --summary "<reviewed summary>"`,
      '',
      'If this output clearly covers downstream tasks that have not started or are waiting for review/input, you may close those covered tasks early too:',
      'pulse-canvas team complete-task --task "<covered downstream task id>" --summary "<why this task was already satisfied>"',
      'Do not mark an actively running downstream task complete; send the teammate guidance instead.',
      ...(downstreamLines.length > 0
        ? [
          '',
          'Direct downstream tasks to check:',
          ...downstreamLines,
        ]
        : []),
      '',
      'If follow-up is needed, run:',
      'pulse-canvas team create-task --title "..." --description "..." --owner "..." --dispatch',
    ].join('\n');
  }

  private async formatFinalReviewPrompt(teamId: TeamId): Promise<string> {
    const snapshot = await this.snapshot(teamId);
    const taskLines = snapshot.tasks.map((task) => {
      const result = task.result ? ` — ${truncate(task.result, 220)}` : '';
      return `- ${task.title}: ${task.status}${result}`;
    });
    const artifactLines = snapshot.artifacts.map((artifact) =>
      `- ${artifact.title} (${artifact.kind})${artifact.summary ? ` — ${truncate(artifact.summary, 180)}` : ''}`,
    );
    return [
      `All currently dispatched team tasks are finished for "${snapshot.team.name}".`,
      '',
      'Review the task results and artifacts. If the work is complete, run:',
      'pulse-canvas team complete-team --summary "<final summary>"',
      '',
      'If more work is needed, create follow-up tasks instead:',
      'pulse-canvas team create-task --title "..." --description "..." --owner "..." --dispatch',
      '',
      'Tasks:',
      ...taskLines,
      ...(artifactLines.length > 0 ? ['', 'Artifacts:', ...artifactLines] : []),
    ].join('\n');
  }

  private async formatLeadPendingGateDigest(teamId: TeamId): Promise<string> {
    const [gates, agents, tasks] = await Promise.all([
      this.store.listHumanGates(teamId),
      this.store.listAgents(teamId),
      this.store.listTasks(teamId),
    ]);
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const pending = gates
      .filter((gate) => {
        if (gate.status !== 'open' || !isLeadAudienceGate(gate.metadata)) return false;
        // Exclude gates whose task already finished. Their questions are settled,
        // so they must not keep re-waking the Team Lead about completed work.
        const task = gate.taskId ? tasksById.get(gate.taskId) : undefined;
        return !task || (task.status !== 'done' && task.status !== 'failed');
      })
      .sort((a, b) => a.createdAt - b.createdAt);
    if (pending.length === 0) return '';

    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const lines = pending.flatMap((gate, index) => {
      const agent = gate.agentId ? agentsById.get(gate.agentId) : undefined;
      const task = gate.taskId ? tasksById.get(gate.taskId) : undefined;
      const agentName = agent?.name ?? 'Teammate name';
      const taskPart = task ? ` — ${task.title}` : '';
      return [
        `${index + 1}. ${agentName}${taskPart}`,
        `   Question: ${truncate(gate.prompt, 500)}`,
        `   Answer if you can: pulse-canvas team send --to "${quoteCliValue(agentName)}"${gate.taskId ? ` --task "${quoteCliValue(gate.taskId)}"` : ''} --message "<answer or decision>"`,
        `   Ask the human only if needed: pulse-canvas team request-human-input${gate.taskId ? ` --task "${quoteCliValue(gate.taskId)}"` : ''} --prompt "<specific question>"`,
      ];
    });

    return [
      `Current teammate questions waiting for Team Lead (${pending.length}):`,
      ...lines,
    ].join('\n');
  }

  private async notifyLead(teamId: TeamId, content: string, taskId?: TaskId): Promise<void> {
    const team = await this.requireTeam(teamId);
    const lead = team.leadAgentId ? await this.store.getAgent(team.leadAgentId) : undefined;
    if (!lead) return;
    await this.appendMessage({
      teamId,
      from: 'runtime',
      to: lead.id,
      type: 'status_update',
      content,
      taskId,
    });
    if (!this.agentSessions || !lead.sessionRef) return;

    const pendingGateDigest = await this.formatLeadPendingGateDigest(teamId);
    await this.agentSessions.sendInput(lead.sessionRef.sessionId, [
      LEAD_NOTIFICATION_GUARD,
      '',
      content,
      ...(pendingGateDigest ? ['', pendingGateDigest] : []),
    ].join('\n'));

    if (pendingGateDigest) {
      this.leadPendingDigestCache.set(teamId, { digest: pendingGateDigest, sentAt: this.now() });
    } else {
      this.leadPendingDigestCache.delete(teamId);
    }
    lead.status = 'running';
    lead.updatedAt = this.now();
    await this.store.saveAgent(lead);
  }

  /**
   * Cancel any still-open human gates tied to a task. Once a task is done or
   * failed its open questions are moot; leaving the gates open would keep
   * feeding the Team Lead's pending backlog and re-waking the lead about
   * already-settled work.
   */
  private async cancelOpenGatesForTask(teamId: TeamId, taskId: TaskId): Promise<void> {
    const gates = await this.store.listHumanGates(teamId);
    const now = this.now();
    for (const gate of gates) {
      if (gate.status !== 'open' || gate.taskId !== taskId) continue;
      gate.status = 'cancelled';
      gate.updatedAt = now;
      await this.store.saveHumanGate(gate);
    }
  }

  private async findOpenGateForAgent(agent: TeamAgentRecord, taskId?: TaskId) {
    const gates = await this.store.listHumanGates(agent.teamId);
    const candidates = gates.filter((gate) => gate.status === 'open' && gate.agentId === agent.id);
    if (taskId) return candidates.find((gate) => gate.taskId === taskId);
    if (agent.currentTaskId) {
      return candidates.find((gate) => !gate.taskId || gate.taskId === agent.currentTaskId);
    }
    return candidates.length === 1 ? candidates[0] : candidates.find((gate) => !gate.taskId);
  }

  private async appendMessage(input: Omit<MailboxMessage, 'id' | 'createdAt'>): Promise<MailboxMessage> {
    const message: MailboxMessage = {
      ...input,
      id: this.idFactory(),
      createdAt: this.now(),
    };
    await this.store.appendMessage(message);
    return message;
  }

  private async emit(
    teamId: TeamId,
    type: TeamEventType,
    actor: AgentId | 'human' | 'runtime',
    payload: Record<string, unknown>,
  ): Promise<TeamEvent> {
    const event: TeamEvent = {
      id: this.idFactory(),
      teamId,
      type,
      timestamp: this.now(),
      actor,
      payload,
    };
    await this.store.appendEvent(event);
    for (const handler of this.handlers) handler(event);
    return event;
  }

  private async requireTeam(teamId: TeamId) {
    const team = await this.store.getTeam(teamId);
    if (!team) throw new Error(`Team not found: ${teamId}`);
    return team;
  }

  private async requireAgent(agentId: AgentId) {
    const agent = await this.store.getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return agent;
  }

  private async requireTask(taskId: TaskId) {
    const task = await this.store.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  private async requireHumanGate(gateId: HumanGateId) {
    const gate = await this.store.getHumanGate(gateId);
    if (!gate) throw new Error(`Human gate not found: ${gateId}`);
    return gate;
  }
}
