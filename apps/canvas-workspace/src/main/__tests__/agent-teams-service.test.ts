import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockState = vi.hoisted(() => ({
  root: '',
  createdTeams: [] as any[],
  createdAgents: [] as any[],
  cwdUpdates: [] as Array<{ workspaceId: string; teamId: string; cwd: string }>,
  queuedInputs: [] as Array<{ workspaceId: string; nodeId: string; input: string }>,
  interrupts: [] as Array<{ workspaceId: string; nodeId: string; mode: string }>,
}));

vi.mock('../canvas/storage', () => ({
  get STORE_DIR() {
    return mockState.root;
  },
}));

vi.mock('../canvas/broadcast', () => ({
  broadcastCanvasUpdate: vi.fn(),
  broadcastAgentTeamsEvent: vi.fn(),
}));

vi.mock('../agent-teams/canvas-nodes', () => ({
  createAgentTeamCanvasNodes: vi.fn(async (input: any) => {
    mockState.createdTeams.push(input);
    const agentNodeIds: Record<string, string> = {
      [input.lead.agentId]: `node-${input.lead.agentId}`,
    };
    for (const teammate of input.teammates) {
      agentNodeIds[teammate.agentId] = `node-${teammate.agentId}`;
    }
    return {
      frameNodeId: `frame-${input.teamId}`,
      agentNodeIds,
    };
  }),
  createTeamAgentNode: vi.fn(async (input: any) => {
    mockState.createdAgents.push(input);
    return `node-${input.agentId}`;
  }),
  getCanvasAgentNode: vi.fn(async (_workspaceId: string, nodeId: string) => ({
    workspaceId: 'ws-1',
    nodeId,
    title: nodeId,
    status: 'running',
    ptySessionId: `pty-${nodeId}`,
  })),
  sendOrQueueAgentInput: vi.fn(async (workspaceId: string, nodeId: string, input: string) => {
    mockState.queuedInputs.push({ workspaceId, nodeId, input });
  }),
  persistAgentNodeLaunchPrompt: vi.fn(async () => {}),
  interruptCanvasAgentNode: vi.fn(async (workspaceId: string, nodeId: string, mode: string) => {
    mockState.interrupts.push({ workspaceId, nodeId, mode });
  }),
  ensureAgentTeamCanvasLayout: vi.fn(async () => {}),
  removeAgentTeamCanvasNodes: vi.fn(async () => []),
  stopAgentTeamCanvasNodes: vi.fn(async () => []),
  updateAgentTeamCanvasCwd: vi.fn(async (workspaceId: string, teamId: string, cwd: string) => {
    mockState.cwdUpdates.push({ workspaceId, teamId, cwd });
    return [`node-${teamId}`];
  }),
}));

import { CanvasAgentTeamsService } from '../agent-teams/service';
import { removeAgentTeamCanvasNodes } from '../agent-teams/canvas-nodes';
import { broadcastAgentTeamsEvent } from '../canvas/broadcast';
import type { CanvasAgentTeamSnapshot } from '../agent-teams/types';

const plan = {
  summary: 'Refactor checkout safely with implementation and review lanes.',
  teammates: [
    { name: 'Codex Exec', agentType: 'codex' },
    { name: 'Reviewer', agentType: 'codex' },
  ],
  tasks: [
    {
      title: 'Implement checkout refactor',
      description: 'Move payment orchestration into a service and keep the public API stable.',
      ownerName: 'Codex Exec',
    },
    {
      title: 'Review checkout refactor',
      description: 'Review the implementation and call out regressions.',
      ownerName: 'Reviewer',
      deps: ['Implement checkout refactor'],
    },
  ],
};

const createTeam = async (service: CanvasAgentTeamsService): Promise<CanvasAgentTeamSnapshot> =>
  service.createTeam({
    workspaceId: 'ws-1',
    name: 'Checkout Team',
    goal: 'Refactor checkout safely',
    cwd: '/repo',
    leadName: 'Claude Plan',
  });

const emitPlan = async (
  service: CanvasAgentTeamsService,
  snapshot: CanvasAgentTeamSnapshot,
): Promise<CanvasAgentTeamSnapshot> => {
  const lead = snapshot.runtime.agents.find((agent) => agent.role === 'lead')!;
  const planned = await service.reportAgentOutput(
    'ws-1',
    lead.sessionRef!.sessionId,
    `[agent-team:plan] ${JSON.stringify(plan)}\n`,
  );
  expect(planned).not.toBeNull();
  return planned!;
};

const createExecutingTeam = async (service: CanvasAgentTeamsService): Promise<CanvasAgentTeamSnapshot> => {
  const created = await createTeam(service);
  await emitPlan(service, created);
  return service.confirmPlan('ws-1', created.runtime.team.id);
};

describe('CanvasAgentTeamsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.root = join(tmpdir(), `canvas-agent-teams-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mockState.createdTeams.length = 0;
    mockState.createdAgents.length = 0;
    mockState.cwdUpdates.length = 0;
    mockState.queuedInputs.length = 0;
    mockState.interrupts.length = 0;
  });

  afterEach(async () => {
    await fs.rm(mockState.root, { recursive: true, force: true });
  });

  it('creates a leader-first team with no teammates or tasks yet', async () => {
    const service = new CanvasAgentTeamsService();

    const snapshot = await createTeam(service);

    expect(snapshot.workspaceId).toBe('ws-1');
    expect(snapshot.frameNodeId).toBe(`frame-${snapshot.runtime.team.id}`);
    expect(snapshot.phase).toBe('briefing');
    expect(snapshot.runtime.team.name).toBe('Checkout Team');
    expect(snapshot.runtime.team.goal).toBe('Refactor checkout safely');
    expect(snapshot.runtime.agents).toHaveLength(1);
    expect(snapshot.runtime.agents[0]).toMatchObject({ role: 'lead', name: 'Claude Plan' });
    expect(snapshot.runtime.tasks).toHaveLength(0);
    expect(mockState.createdTeams[0].cwd).toBe('/repo');
    expect(mockState.createdTeams[0].lead.agentType).toBe('codex');
    expect(mockState.createdTeams[0].teammates).toEqual([]);
  });

  it('briefs the leader with CLI planning instructions and still supports legacy plan markers', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createTeam(service);
    const lead = created.runtime.agents[0];

    const briefed = await service.briefLead('ws-1', created.runtime.team.id, 'Please split checkout refactor work.');
    expect(briefed.phase).toBe('briefing');
    expect(mockState.queuedInputs).toHaveLength(1);
    expect(mockState.queuedInputs[0].nodeId).toBe(lead.sessionRef!.sessionId);
    expect(mockState.queuedInputs[0].input).toContain('Please split checkout refactor work.');
    expect(mockState.queuedInputs[0].input).toContain('pulse-canvas team propose-plan --plan-json');
    expect(mockState.queuedInputs[0].input).toContain('pulse-canvas team propose-plan --plan-file');
    expect(mockState.queuedInputs[0].input).toContain('PULSE_CANVAS_TEAM_ID');
    expect(mockState.queuedInputs[0].input).toContain('Do not implement the task yourself');
    expect(mockState.queuedInputs[0].input).toContain('Every task object MUST include "deps"');
    expect(mockState.queuedInputs[0].input).toContain('Use deps to encode the real execution order');
    expect(mockState.queuedInputs[0].input).toContain('4-10 tasks for normal app/repo work');
    expect(mockState.queuedInputs[0].input).toContain('Target 2-4 ready-to-start workstreams');
    expect(mockState.queuedInputs[0].input).toContain('do not create one microtask per file');
    expect(mockState.queuedInputs[0].input).toContain('Make each task narrow and non-overlapping');
    expect(mockState.queuedInputs[0].input).toContain('"QA integration and fixes"');

    const planned = await emitPlan(service, created);
    expect(planned.phase).toBe('plan_review');
    expect(planned.pendingPlan?.summary).toBe(plan.summary);
    expect(planned.pendingPlan?.teammates).toHaveLength(2);
    expect(planned.pendingPlan?.tasks).toHaveLength(2);
    expect(planned.pendingPlan?.tasks[0].deps).toEqual([]);
    expect(planned.pendingPlan?.tasks[1].deps).toEqual(['Implement checkout refactor']);
    expect(planned.runtime.team.status).toBe('waiting_approval');

    const confirmed = await service.confirmPlan('ws-1', created.runtime.team.id);
    expect(confirmed.phase).toBe('executing');
    expect(confirmed.pendingPlan).toBeUndefined();
    expect(confirmed.approvedPlan?.summary).toBe(plan.summary);
    expect(confirmed.runtime.agents.map((agent) => agent.name).sort()).toEqual([
      'Claude Plan',
      'Codex Exec',
      'Reviewer',
    ].sort());
    expect(confirmed.runtime.tasks.map((task) => task.title)).toEqual([
      'Implement checkout refactor',
      'Review checkout refactor',
    ]);
    expect(mockState.createdAgents.map((input) => input.name).sort()).toEqual(['Codex Exec', 'Reviewer'].sort());
    expect(mockState.queuedInputs.some((entry) => entry.input.includes('Implement checkout refactor'))).toBe(true);
  });

  it('adopts an explicit existing cwd from the leader brief for downstream teammates', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createTeam(service);
    const teamId = created.runtime.team.id;
    const targetCwd = join(mockState.root, 'target-repo');
    await fs.mkdir(targetCwd, { recursive: true });

    await service.briefLead(
      'ws-1',
      teamId,
      `Please build this in ${targetCwd} and split the implementation work.`,
    );

    expect(mockState.cwdUpdates).toEqual([{ workspaceId: 'ws-1', teamId, cwd: targetCwd }]);
    expect(mockState.queuedInputs.at(-1)?.input).toContain(`Team working directory: ${targetCwd}`);

    await emitPlan(service, created);
    const confirmed = await service.confirmPlan('ws-1', teamId);

    expect(confirmed.runtime.agents.map((agent) => [agent.name, agent.cwd]).sort()).toEqual([
      ['Claude Plan', targetCwd],
      ['Codex Exec', targetCwd],
      ['Reviewer', targetCwd],
    ].sort());
    expect(mockState.createdAgents.map((input) => input.cwd)).toEqual([targetCwd, targetCwd]);
    // Dispatched task prompts carry the adopted cwd. (The plan-approved notice
    // to the lead is queued after them, so search instead of taking the last.)
    expect(mockState.queuedInputs.some((queued) => queued.input.includes(`Working directory: ${targetCwd}`))).toBe(true);
  });

  it('accepts a structured plan from the CLI propose-plan path', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createTeam(service);
    const lead = created.runtime.agents[0];

    const proposed = await service.proposePlan('ws-1', created.runtime.team.id, {
      sourceAgentId: lead.id,
      plan,
    });

    expect(proposed.phase).toBe('plan_review');
    expect(proposed.pendingPlan?.summary).toBe(plan.summary);
    expect(proposed.pendingPlan?.sourceAgentId).toBe(lead.id);
    expect(proposed.pendingPlan?.teammates).toHaveLength(2);
    expect(proposed.pendingPlan?.tasks).toHaveLength(2);
    expect(proposed.runtime.team.status).toBe('waiting_approval');
    expect(proposed.runtime.agents[0].status).toBe('needs_input');

    const confirmed = await service.confirmPlan('ws-1', created.runtime.team.id);
    expect(confirmed.phase).toBe('executing');
    expect(confirmed.runtime.agents.some((agent) => agent.name === 'Codex Exec')).toBe(true);
    expect(confirmed.runtime.tasks.map((task) => task.title)).toEqual([
      'Implement checkout refactor',
      'Review checkout refactor',
    ]);
  });

  it('re-assigns a teammate coding agent while the plan is under review', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createTeam(service);
    await emitPlan(service, created);
    const teamId = created.runtime.team.id;

    const updated = await service.updatePlanTeammate('ws-1', teamId, {
      teammateName: 'Reviewer',
      agentType: 'claude-code',
    });
    expect(updated.phase).toBe('plan_review');
    expect(updated.pendingPlan?.teammates.find((teammate) => teammate.name === 'Reviewer')?.agentType)
      .toBe('claude-code');
    expect(updated.pendingPlan?.teammates.find((teammate) => teammate.name === 'Codex Exec')?.agentType)
      .toBe('codex');

    // The reassigned agent type flows through to the teammate node on approval.
    const confirmed = await service.confirmPlan('ws-1', teamId);
    expect(confirmed.phase).toBe('executing');
    expect(mockState.createdAgents.find((input) => input.name === 'Reviewer')?.agentType).toBe('claude-code');
    expect(mockState.createdAgents.find((input) => input.name === 'Codex Exec')?.agentType).toBe('codex');

    // Editing is only allowed during plan review.
    await expect(service.updatePlanTeammate('ws-1', teamId, { teammateName: 'Reviewer', agentType: 'codex' }))
      .rejects.toThrow('under review');
  });

  it('rejects re-assigning an unknown teammate in the pending plan', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createTeam(service);
    await emitPlan(service, created);

    await expect(service.updatePlanTeammate('ws-1', created.runtime.team.id, {
      teammateName: 'Nope',
      agentType: 'codex',
    })).rejects.toThrow('Teammate not found in plan');
  });

  it('resolves plan task dependencies as a full graph before dispatch', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createTeam(service);
    const lead = created.runtime.agents[0];
    const forwardPlan = {
      summary: 'Create implementation first, then review it.',
      teammates: [
        { name: 'Codex Exec', agentType: 'codex' },
        { name: 'Reviewer', agentType: 'codex' },
      ],
      tasks: [
        {
          title: 'Review checkout refactor',
          description: 'Review the implementation and call out regressions.',
          ownerName: 'Reviewer',
          deps: ['Implement checkout refactor'],
        },
        {
          title: 'Implement checkout refactor',
          description: 'Move payment orchestration into a service and keep the public API stable.',
          ownerName: 'Codex Exec',
        },
      ],
    };

    await service.proposePlan('ws-1', created.runtime.team.id, {
      sourceAgentId: lead.id,
      plan: forwardPlan,
    });
    const confirmed = await service.confirmPlan('ws-1', created.runtime.team.id);
    const implement = confirmed.runtime.tasks.find((task) => task.title === 'Implement checkout refactor')!;
    const review = confirmed.runtime.tasks.find((task) => task.title === 'Review checkout refactor')!;

    expect(review.deps).toEqual([implement.id]);
    expect(implement.status).toBe('in_progress');
    expect(review.status).toBe('todo');
    expect(mockState.queuedInputs.some((entry) => entry.input.includes('Implement checkout refactor'))).toBe(true);
    expect(mockState.queuedInputs.some((entry) => entry.input.includes('Review the implementation'))).toBe(false);
  });

  it('rejects cyclic plan task dependencies before creating teammates', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createTeam(service);
    const lead = created.runtime.agents[0];

    await service.proposePlan('ws-1', created.runtime.team.id, {
      sourceAgentId: lead.id,
      plan: {
        summary: 'Invalid cyclic plan.',
        teammates: [{ name: 'Codex Exec', agentType: 'codex' }],
        tasks: [
          { title: 'Task A', description: 'Do A.', ownerName: 'Codex Exec', deps: ['Task B'] },
          { title: 'Task B', description: 'Do B.', ownerName: 'Codex Exec', deps: ['Task A'] },
        ],
      },
    });

    await expect(service.confirmPlan('ws-1', created.runtime.team.id))
      .rejects.toThrow('Task dependency cycle detected');
    expect(mockState.createdAgents).toHaveLength(0);
  });

  it('persists leader-first teams and pending plans so a new service can confirm them', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createTeam(service);
    await emitPlan(service, created);

    const restoredService = new CanvasAgentTeamsService();
    const teams = await restoredService.listTeams('ws-1');

    expect(teams).toHaveLength(1);
    expect(teams[0].phase).toBe('plan_review');
    expect(teams[0].pendingPlan?.summary).toBe(plan.summary);
    expect(teams[0].runtime.agents.map((agent) => agent.name)).toEqual(['Claude Plan']);

    const confirmed = await restoredService.confirmPlan('ws-1', created.runtime.team.id);
    expect(confirmed.phase).toBe('executing');
    expect(confirmed.runtime.agents.some((agent) => agent.name === 'Codex Exec')).toBe(true);
    expect(mockState.queuedInputs.some((entry) => entry.input.includes('Implement checkout refactor'))).toBe(true);
  });

  it('supports human gates, answers, interrupts, and manual task completion', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const task = created.runtime.tasks[0];
    const agent = created.runtime.agents.find((candidate) => candidate.id === task.ownerAgentId)!;

    const gated = await service.openHumanGate('ws-1', teamId, {
      taskId: task.id,
      agentId: agent.id,
      reason: 'Need approval',
      prompt: 'Approve this plan?',
    });
    const gate = gated.runtime.humanGates[0];
    expect(gate.status).toBe('open');
    expect(gated.runtime.tasks[0].status).toBe('needs_input');

    const answered = await service.answerGate('ws-1', gate.id, 'Approved.');
    expect(answered.runtime.humanGates[0].status).toBe('answered');
    expect(mockState.queuedInputs.at(-1)?.input).toBe('Approved.');

    await service.interruptAgent('ws-1', teamId, agent.id, 'ctrl-c', 'Stop');
    expect(mockState.interrupts.at(-1)).toEqual({
      workspaceId: 'ws-1',
      nodeId: agent.sessionRef!.sessionId,
      mode: 'ctrl-c',
    });

    const completed = await service.completeTask('ws-1', teamId, task.id, 'Done');
    const review = completed.runtime.tasks.find((candidate) => candidate.title === 'Review checkout refactor')!;
    const reviewer = completed.runtime.agents.find((candidate) => candidate.id === review.ownerAgentId)!;
    expect(completed.runtime.tasks[0].status).toBe('done');
    expect(review.status).toBe('in_progress');
    expect(reviewer.status).toBe('running');
    expect(mockState.queuedInputs.at(-1)?.input).toContain('Review checkout refactor');
  });

  it('sends direct input to a team agent session', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const agent = created.runtime.agents.find((candidate) => candidate.role === 'teammate')!;

    const snapshot = await service.sendInput('ws-1', teamId, agent.id, 'Please summarize your current state.');

    expect(snapshot.runtime.messages.at(-1)).toMatchObject({
      from: 'human',
      to: agent.id,
      type: 'answer',
      content: 'Please summarize your current state.',
    });
    expect(mockState.queuedInputs.at(-1)).toEqual({
      workspaceId: 'ws-1',
      nodeId: agent.sessionRef!.sessionId,
      input: 'Please summarize your current state.',
    });
  });

  it('resumes a paused team and redispatches paused teammate work', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const task = created.runtime.tasks[0];
    const owner = created.runtime.agents.find((candidate) => candidate.id === task.ownerAgentId)!;
    const queuedBeforePause = mockState.queuedInputs.length;

    const paused = await service.pauseTeam('ws-1', teamId);

    expect(paused.runtime.team.status).toBe('paused');
    expect(paused.runtime.tasks.find((candidate) => candidate.id === task.id)).toMatchObject({
      status: 'blocked',
      blockedReason: 'Paused from the Agent Team frame.',
    });
    await expect(service.prepareAgentAutoResume('ws-1', teamId, owner.id))
      .resolves.toMatchObject({ canResume: false });

    const resumed = await service.resumeTeam('ws-1', teamId);
    const resumedTask = resumed.runtime.tasks.find((candidate) => candidate.id === task.id)!;
    const resumedOwner = resumed.runtime.agents.find((candidate) => candidate.id === owner.id)!;

    expect(resumed.runtime.team.status).toBe('running');
    expect(resumedTask.status).toBe('in_progress');
    expect(resumedTask.blockedReason).toBeUndefined();
    expect(resumedTask.metadata?.teamPause).toBeUndefined();
    expect(resumedOwner).toMatchObject({
      status: 'running',
      currentTaskId: task.id,
    });
    expect(mockState.queuedInputs).toHaveLength(queuedBeforePause + 1);
    expect(mockState.queuedInputs.at(-1)).toMatchObject({
      workspaceId: 'ws-1',
      nodeId: owner.sessionRef!.sessionId,
    });
    expect(mockState.queuedInputs.at(-1)?.input).toContain(task.title);
  });

  it('passes saved canvas node ids into cleanup when deleting a team', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const expectedIds = [
      created.frameNodeId,
      ...created.runtime.agents.map((agent) => agent.sessionRef?.sessionId),
    ].filter((nodeId): nodeId is string => !!nodeId);
    vi.mocked(removeAgentTeamCanvasNodes).mockResolvedValueOnce(expectedIds);

    const result = await service.deleteTeam('ws-1', teamId);

    expect(result.deletedNodeIds).toEqual(expectedIds);
    expect(removeAgentTeamCanvasNodes).toHaveBeenLastCalledWith(
      'ws-1',
      teamId,
      expect.arrayContaining(expectedIds),
    );
    await expect(service.listTeams('ws-1')).resolves.toEqual([]);
  });

  it('treats direct teammate input as an answer to that teammate open gate', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const task = created.runtime.tasks[0];
    const agent = created.runtime.agents.find((candidate) => candidate.id === task.ownerAgentId)!;

    const gated = await service.openHumanGate('ws-1', teamId, {
      taskId: task.id,
      agentId: agent.id,
      reason: 'Need lead decision',
      prompt: 'Should I keep the current public API?',
    });
    expect(gated.runtime.tasks[0].status).toBe('needs_input');

    const answered = await service.sendInput('ws-1', teamId, agent.name, 'Keep the current public API.');
    const answeredTask = answered.runtime.tasks.find((candidate) => candidate.id === task.id)!;
    const answeredAgent = answered.runtime.agents.find((candidate) => candidate.id === agent.id)!;
    const answeredGate = answered.runtime.humanGates.find((gate) => gate.taskId === task.id)!;

    expect(answeredGate).toMatchObject({
      status: 'answered',
      answer: 'Keep the current public API.',
    });
    expect(answeredTask.status).toBe('in_progress');
    expect(answeredTask.blockedReason).toBeUndefined();
    expect(answeredAgent.status).toBe('running');
    expect(mockState.queuedInputs.at(-1)).toEqual({
      workspaceId: 'ws-1',
      nodeId: agent.sessionRef!.sessionId,
      input: 'Keep the current public API.',
    });
  });

  it('wraps execution notes to the lead with team action guidance', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const lead = created.runtime.agents.find((candidate) => candidate.role === 'lead')!;

    const snapshot = await service.sendInput('ws-1', teamId, lead.name, 'Have frontend adjust the checkout copy.');

    expect(snapshot.runtime.messages.at(-1)?.to).toBe(lead.id);
    expect(mockState.queuedInputs.at(-1)?.nodeId).toBe(lead.sessionRef!.sessionId);
    expect(mockState.queuedInputs.at(-1)?.input).toContain('Human follow-up for "Checkout Team"');
    expect(mockState.queuedInputs.at(-1)?.input).toContain('do not create a duplicate task');
    expect(mockState.queuedInputs.at(-1)?.input).toContain('pulse-canvas team send --to "Teammate name"');
    expect(mockState.queuedInputs.at(-1)?.input).toContain('already produced enough work to satisfy later tasks');
    expect(mockState.queuedInputs.at(-1)?.input).toContain('pulse-canvas team complete-task --task "<covered downstream task id or title>"');
    expect(mockState.queuedInputs.at(-1)?.input).toContain('pulse-canvas team create-task');
    expect(mockState.queuedInputs.at(-1)?.input).toContain('Do not run sleep, watch, tail, polling loops');
    expect(mockState.queuedInputs.at(-1)?.input).toContain('Have frontend adjust the checkout copy.');
  });

  it('reopens a completed team when sending the lead a next task', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const lead = created.runtime.agents.find((agent) => agent.role === 'lead')!;
    const implement = created.runtime.tasks.find((task) => task.title === 'Implement checkout refactor')!;
    const implemented = await service.completeAgentTask({
      workspaceId: 'ws-1',
      teamId,
      taskId: implement.id,
      summary: 'Implementation is done.',
    });
    const review = implemented.runtime.tasks.find((task) => task.title === 'Review checkout refactor')!;
    await service.completeAgentTask({
      workspaceId: 'ws-1',
      teamId,
      taskId: review.id,
      summary: 'Review passed.',
    });
    const completed = await service.completeTeam('ws-1', teamId, {
      sourceAgentId: lead.id,
      summary: 'Checkout refactor completed and reviewed.',
    });
    expect(completed.runtime.team.status).toBe('completed');

    const reopened = await service.sendInput('ws-1', teamId, lead.id, 'Start the next milestone.');
    const reopenedLead = reopened.runtime.agents.find((agent) => agent.id === lead.id)!;

    expect(reopened.runtime.team.status).toBe('running');
    expect(reopenedLead.status).toBe('running');
    expect(mockState.queuedInputs.at(-1)).toMatchObject({
      workspaceId: 'ws-1',
      nodeId: lead.sessionRef!.sessionId,
    });
    expect(mockState.queuedInputs.at(-1)?.input).toContain('Start the next milestone.');
    await expect(service.prepareAgentAutoResume('ws-1', teamId, lead.id))
      .resolves.toMatchObject({ canResume: true });
  });

  it('creates follow-up tasks by owner name and dependency title', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const implement = created.runtime.tasks.find((task) => task.title === 'Implement checkout refactor')!;
    await service.completeTask('ws-1', teamId, implement.id, 'Checkout API remains stable.');

    const runtime = await service.createTask({
      workspaceId: 'ws-1',
      teamId,
      title: 'Polish checkout copy',
      description: 'Update the checkout copy using the stable API.',
      ownerName: 'Reviewer',
      depRefs: ['Implement checkout refactor'],
    });
    const followUp = runtime.tasks.find((task) => task.title === 'Polish checkout copy')!;
    const owner = runtime.agents.find((agent) => agent.name === 'Reviewer')!;

    expect(followUp.ownerAgentId).toBe(owner.id);
    expect(followUp.deps).toEqual([implement.id]);
  });

  it('dispatches ready tasks created with the dispatch flag', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const reviewerBefore = created.runtime.agents.find((agent) => agent.name === 'Reviewer')!;
    expect(reviewerBefore.status).toBe('idle');

    const runtime = await service.createTask({
      workspaceId: 'ws-1',
      teamId,
      title: 'Check release notes',
      description: 'Review the release notes while implementation continues.',
      ownerName: 'Reviewer',
      dispatch: true,
    });
    const followUp = runtime.tasks.find((task) => task.title === 'Check release notes')!;
    const reviewer = runtime.agents.find((agent) => agent.name === 'Reviewer')!;

    expect(followUp.status).toBe('in_progress');
    expect(reviewer.status).toBe('running');
    expect(reviewer.currentTaskId).toBe(followUp.id);
    expect(mockState.queuedInputs.at(-1)).toMatchObject({
      workspaceId: 'ws-1',
      nodeId: reviewer.sessionRef!.sessionId,
    });
    expect(mockState.queuedInputs.at(-1)?.input).toContain('Check release notes');
  });

  it('lets teammate CLI actions complete tasks and dispatch dependent work', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const implement = created.runtime.tasks.find((task) => task.title === 'Implement checkout refactor')!;
    const owner = created.runtime.agents.find((agent) => agent.id === implement.ownerAgentId)!;

    const completed = await service.completeAgentTask({
      workspaceId: 'ws-1',
      teamId,
      sourceAgentId: owner.id,
      summary: 'Checkout API remains stable.',
    });
    const review = completed.runtime.tasks.find((task) => task.title === 'Review checkout refactor')!;
    const reviewer = completed.runtime.agents.find((agent) => agent.id === review.ownerAgentId)!;

    expect(completed.runtime.tasks.find((task) => task.id === implement.id)).toMatchObject({
      status: 'done',
      result: 'Checkout API remains stable.',
    });
    expect(review.status).toBe('in_progress');
    expect(reviewer.status).toBe('running');
    expect(mockState.queuedInputs.at(-1)).toMatchObject({
      workspaceId: 'ws-1',
      nodeId: reviewer.sessionRef!.sessionId,
    });
    expect(mockState.queuedInputs.at(-1)?.input).toContain('Dependency context from completed upstream tasks');
    expect(mockState.queuedInputs.at(-1)?.input).toContain('Checkout API remains stable.');
  });

  it('marks an exited teammate task for lead review when no completion action was reported', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const task = created.runtime.tasks[0];
    const owner = created.runtime.agents.find((agent) => agent.id === task.ownerAgentId)!;
    const lead = created.runtime.agents.find((agent) => agent.role === 'lead')!;

    const reviewed = await service.reportAgentExit('ws-1', owner.sessionRef!.sessionId, 0);

    expect(reviewed?.runtime.tasks[0]).toMatchObject({
      status: 'needs_review',
      blockedReason: 'Agent session exited with code 0 before reporting task completion.',
    });
    expect(reviewed?.runtime.agents.find((agent) => agent.id === owner.id)?.status).toBe('idle');
    expect(mockState.queuedInputs.at(-1)).toMatchObject({
      workspaceId: 'ws-1',
      nodeId: lead.sessionRef!.sessionId,
    });
    expect(mockState.queuedInputs.at(-1)?.input).toContain('Task needs review');
    expect(mockState.queuedInputs.at(-1)?.input).toContain('pulse-canvas team complete-task');
  });

  it('prepares automatic resume for a teammate task interrupted by session exit', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const task = created.runtime.tasks[0];
    const owner = created.runtime.agents.find((agent) => agent.id === task.ownerAgentId)!;

    await service.reportAgentExit('ws-1', owner.sessionRef!.sessionId, 1);
    const queuedBeforePrepare = mockState.queuedInputs.length;
    const prepared = await service.prepareAgentAutoResume('ws-1', teamId, owner.id);
    const preparedTask = prepared.snapshot.runtime.tasks.find((candidate) => candidate.id === task.id)!;
    const preparedOwner = prepared.snapshot.runtime.agents.find((agent) => agent.id === owner.id)!;

    expect(prepared.canResume).toBe(true);
    expect(prepared.snapshot.runtime.team.status).toBe('running');
    expect(preparedTask.status).toBe('in_progress');
    expect(preparedTask.blockedReason).toBeUndefined();
    expect(preparedOwner).toMatchObject({
      status: 'running',
      currentTaskId: task.id,
    });
    expect(mockState.queuedInputs).toHaveLength(queuedBeforePrepare);
  });

  it('stamps a structured review kind on session-exit reviews and clears it on auto-resume', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const task = created.runtime.tasks[0];
    const owner = created.runtime.agents.find((agent) => agent.id === task.ownerAgentId)!;

    const reviewed = await service.reportAgentExit('ws-1', owner.sessionRef!.sessionId, 1);
    const reviewedTask = reviewed?.runtime.tasks.find((candidate) => candidate.id === task.id);
    expect(reviewedTask?.status).toBe('needs_review');
    expect(reviewedTask?.metadata?.reviewKind).toBe('session-exit');

    const prepared = await service.prepareAgentAutoResume('ws-1', teamId, owner.id);
    const preparedTask = prepared.snapshot.runtime.tasks.find((candidate) => candidate.id === task.id);
    expect(prepared.canResume).toBe(true);
    expect(preparedTask?.status).toBe('in_progress');
    expect(preparedTask?.metadata?.reviewKind).toBeUndefined();
  });

  it('recovers a session-exit review through metadata even when the reason text differs', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const task = created.runtime.tasks[0];
    const owner = created.runtime.agents.find((agent) => agent.id === task.ownerAgentId)!;

    await service.reportAgentExit('ws-1', owner.sessionRef!.sessionId, 1);
    const statePath = join(mockState.root, 'ws-1', 'agent-teams', 'state.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    const storedTask = state.tasks.find((candidate: any) => candidate.id === task.id);
    // The human-readable reason is presentation, not state: recovery must not
    // depend on its exact wording.
    storedTask.blockedReason = 'Reworded copy that no longer matches the legacy regex.';
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');

    const prepared = await new CanvasAgentTeamsService().prepareAgentAutoResume('ws-1', teamId, owner.id);
    expect(prepared.canResume).toBe(true);
    expect(prepared.snapshot.runtime.tasks.find((candidate) => candidate.id === task.id)?.status).toBe('in_progress');
  });

  it('dispatches ready-but-unassigned work from the maintenance heartbeat', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const implement = created.runtime.tasks.find((task) => task.title === 'Implement checkout refactor')!;
    // Completing the first task frees its owner while the review task keeps
    // the team running.
    await service.completeAgentTask({ workspaceId: 'ws-1', teamId, taskId: implement.id, summary: 'done' });

    // New work created without the dispatch flag sits in todo with an idle owner.
    await service.createTask({
      workspaceId: 'ws-1',
      teamId,
      title: 'Follow-up hardening',
      description: 'Harden the refactor.',
      ownerName: 'Codex Exec',
    });
    const before = await service.snapshot('ws-1', teamId);
    expect(before.runtime.tasks.find((task) => task.title === 'Follow-up hardening')?.status).toBe('todo');

    await service.maintainTeam('ws-1', teamId);

    const after = await service.snapshot('ws-1', teamId);
    expect(after.runtime.tasks.find((task) => task.title === 'Follow-up hardening')?.status).toBe('in_progress');
  });

  it('broadcasts push events for runtime changes so open frames can refresh', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);

    const calls = vi.mocked(broadcastAgentTeamsEvent).mock.calls.map(([payload]) => payload);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((payload) => payload.workspaceId === 'ws-1')).toBe(true);
    expect(calls.some((payload) => payload.teamId === created.runtime.team.id && payload.type === 'task_assigned')).toBe(true);
    // Metadata-only changes (plan proposed via marker) push too.
    expect(calls.some((payload) => payload.type === 'plan_proposed')).toBe(true);
  });

  it('prepares automatic resume for a plan-review team lead without approving the plan', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createTeam(service);
    const proposed = await emitPlan(service, created);
    const lead = proposed.runtime.agents.find((agent) => agent.role === 'lead')!;
    const queuedBeforePrepare = mockState.queuedInputs.length;

    expect(proposed.phase).toBe('plan_review');
    expect(proposed.runtime.team.status).toBe('waiting_approval');
    expect(lead.status).toBe('needs_input');

    const prepared = await service.prepareAgentAutoResume('ws-1', proposed.runtime.team.id, lead.id);
    const preparedLead = prepared.snapshot.runtime.agents.find((agent) => agent.id === lead.id)!;

    expect(prepared.canResume).toBe(true);
    expect(prepared.snapshot.phase).toBe('plan_review');
    expect(prepared.snapshot.pendingPlan).toBeDefined();
    expect(prepared.snapshot.runtime.team.status).toBe('waiting_approval');
    expect(preparedLead.status).toBe('running');
    expect(preparedLead.currentTaskId).toBeUndefined();
    expect(prepared.snapshot.runtime.tasks).toHaveLength(0);
    expect(mockState.queuedInputs).toHaveLength(queuedBeforePrepare);
  });

  it('ignores task completion markers in agent output', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const task = created.runtime.tasks[0];
    const owner = created.runtime.agents.find((agent) => agent.id === task.ownerAgentId)!;

    const ignored = await service.reportAgentOutput(
      'ws-1',
      owner.sessionRef!.sessionId,
      `[agent-team:task-completed taskId="${task.id}"] Backend API is complete.`,
    );

    expect(ignored).toBeNull();
    const snapshot = await service.snapshot('ws-1', created.runtime.team.id);
    expect(snapshot.runtime.tasks[0]).toMatchObject({
      status: 'in_progress',
    });
    expect(snapshot.runtime.tasks[0].result).toBeUndefined();
    expect(snapshot.runtime.agents.find((agent) => agent.id === owner.id)?.currentTaskId).toBe(task.id);
  });

  it('ignores a pending completion marker on agent exit and asks for review', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const task = created.runtime.tasks[0];
    const owner = created.runtime.agents.find((agent) => agent.id === task.ownerAgentId)!;

    const pending = await service.reportAgentOutput(
      'ws-1',
      owner.sessionRef!.sessionId,
      `[agent-team:task-completed taskId="${task.id}"]`,
    );
    expect(pending).toBeNull();

    const reviewed = await service.reportAgentExit('ws-1', owner.sessionRef!.sessionId, 0);

    expect(reviewed?.runtime.tasks[0]).toMatchObject({
      status: 'needs_review',
      blockedReason: 'Agent session exited with code 0 before reporting task completion.',
    });
    expect(reviewed?.runtime.tasks[0].result).toBeUndefined();
  });

  it('finalizes a reviewed team only after the lead completes the team', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const lead = created.runtime.agents.find((agent) => agent.role === 'lead')!;
    const implement = created.runtime.tasks.find((task) => task.title === 'Implement checkout refactor')!;
    const implemented = await service.completeAgentTask({
      workspaceId: 'ws-1',
      teamId,
      taskId: implement.id,
      summary: 'Implementation is done.',
    });
    const review = implemented.runtime.tasks.find((task) => task.title === 'Review checkout refactor')!;

    const reviewed = await service.completeAgentTask({
      workspaceId: 'ws-1',
      teamId,
      taskId: review.id,
      summary: 'Review passed.',
    });
    // Every round-1 task is settled, so the team pauses at the checkpoint for
    // the human to advance another round or finalize.
    expect(reviewed.runtime.team.status).toBe('round_checkpoint');

    const finalizing = await service.finalizeFromCheckpoint('ws-1', teamId);
    expect(finalizing.runtime.team.status).toBe('reviewing');
    expect(mockState.queuedInputs.at(-1)?.nodeId).toBe(lead.sessionRef!.sessionId);
    expect(mockState.queuedInputs.at(-1)?.input).toContain('pulse-canvas team complete-team --summary');

    const completed = await service.completeTeam('ws-1', teamId, {
      sourceAgentId: lead.id,
      summary: 'Checkout refactor completed and reviewed.',
    });
    expect(completed.runtime.team.status).toBe('completed');
    expect(completed.runtime.messages.at(-1)).toMatchObject({
      from: lead.id,
      to: 'all',
      type: 'status_update',
      content: 'Checkout refactor completed and reviewed.',
    });
  });

  it('ignores split task completion markers in agent output', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const task = created.runtime.tasks[0];
    const owner = created.runtime.agents.find((agent) => agent.id === task.ownerAgentId)!;

    expect(await service.reportAgentOutput('ws-1', owner.sessionRef!.sessionId, '[agent-team:task-completed taskId="')).toBeNull();
    const ignored = await service.reportAgentOutput(
      'ws-1',
      owner.sessionRef!.sessionId,
      `${task.id}"] Implementation is done.\n`,
    );

    expect(ignored).toBeNull();
    const snapshot = await service.snapshot('ws-1', created.runtime.team.id);
    expect(snapshot.runtime.tasks[0].status).toBe('in_progress');
    expect(snapshot.runtime.tasks[0].result).toBeUndefined();
    expect(snapshot.runtime.agents.find((agent) => agent.id === owner.id)?.status).toBe('running');
  });

  it('routes teammate input markers to the team lead and ignores prompt examples', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const task = created.runtime.tasks[0];
    const owner = created.runtime.agents.find((agent) => agent.id === task.ownerAgentId)!;

    const ignored = await service.reportAgentOutput(
      'ws-1',
      owner.sessionRef!.sessionId,
      `[agent-team:human-input-needed taskId="${task.id}"] <question>\n`,
    );
    expect(ignored).toBeNull();

    const generic = await service.reportAgentOutput(
      'ws-1',
      owner.sessionRef!.sessionId,
      `[agent-team:human-input-needed taskId="${task.id}"] Agent requested human input.\n`,
    );
    expect(generic).toBeNull();

    const gated = await service.reportAgentOutput(
      'ws-1',
      owner.sessionRef!.sessionId,
      `[agent-team:human-input-needed taskId="${task.id}"] Should I update the public API?\n`,
    );
    expect(gated?.runtime.humanGates).toHaveLength(1);
    expect(gated?.runtime.humanGates[0].status).toBe('open');
    expect(gated?.runtime.humanGates[0].metadata).toMatchObject({ audience: 'lead' });
    expect(gated?.runtime.tasks[0].status).toBe('needs_input');
    expect(gated?.runtime.agents.find((agent) => agent.id === owner.id)?.status).toBe('needs_input');

    const duplicate = await service.reportAgentOutput(
      'ws-1',
      owner.sessionRef!.sessionId,
      `[agent-team:human-input-needed taskId="${task.id}"] Should I update the public API?\n`,
    );
    expect(duplicate).toBeNull();
  });

  it('opens a human-facing gate when the team lead asks for human input', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const task = created.runtime.tasks[0];
    const lead = created.runtime.agents.find((agent) => agent.role === 'lead')!;

    const gated = await service.reportAgentOutput(
      'ws-1',
      lead.sessionRef!.sessionId,
      `[agent-team:human-input-needed taskId="${task.id}"] Should we change the public API?\n`,
    );

    expect(gated?.runtime.humanGates).toHaveLength(1);
    expect(gated?.runtime.humanGates[0]).toMatchObject({
      status: 'open',
      prompt: 'Should we change the public API?',
    });
    expect(gated?.runtime.humanGates[0].metadata?.audience).toBeUndefined();
  });

  it('records artifacts and ignores blocked status from agent output markers', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const task = created.runtime.tasks[0];
    const owner = created.runtime.agents.find((agent) => agent.id === task.ownerAgentId)!;

    const withArtifact = await service.reportAgentOutput(
      'ws-1',
      owner.sessionRef!.sessionId,
      `[agent-team:artifact taskId="${task.id}" kind="diff" title="plan.diff"] Initial plan diff.\n`,
    );
    expect(withArtifact?.runtime.artifacts).toHaveLength(1);
    expect(withArtifact?.runtime.artifacts[0]).toMatchObject({
      taskId: task.id,
      agentId: owner.id,
      kind: 'diff',
      title: 'plan.diff',
      summary: 'Initial plan diff.',
    });

    const ignored = await service.reportAgentOutput(
      'ws-1',
      owner.sessionRef!.sessionId,
      `[agent-team:task-blocked taskId="${task.id}"] Waiting for approval.\n`,
    );
    expect(ignored).toBeNull();
    const snapshot = await service.snapshot('ws-1', created.runtime.team.id);
    expect(snapshot.runtime.tasks[0].status).toBe('in_progress');
    expect(snapshot.runtime.tasks[0].blockedReason).toBeUndefined();
    expect(snapshot.runtime.agents.find((agent) => agent.id === owner.id)?.status).toBe('running');
  });

  it('repairs legacy output-marker blocked tasks when the owner still holds them', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const task = created.runtime.tasks[0];
    const owner = created.runtime.agents.find((agent) => agent.id === task.ownerAgentId)!;
    const statePath = join(mockState.root, 'ws-1', 'agent-teams', 'state.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    const storedTask = state.tasks.find((candidate: any) => candidate.id === task.id);
    const storedOwner = state.agents.find((candidate: any) => candidate.id === owner.id);
    storedTask.status = 'blocked';
    storedTask.blockedReason = 'Blocked by agent output marker.';
    storedOwner.status = 'blocked';
    storedOwner.currentTaskId = task.id;
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');

    const freshService = new CanvasAgentTeamsService();
    await freshService.maintainTeam('ws-1', created.runtime.team.id);
    const repaired = await freshService.snapshot('ws-1', created.runtime.team.id);

    expect(repaired.runtime.tasks[0].status).toBe('in_progress');
    expect(repaired.runtime.tasks[0].blockedReason).toBeUndefined();
    expect(repaired.runtime.agents.find((agent) => agent.id === owner.id)?.status).toBe('running');
  });

  it('repairs answered human gates that left tasks stuck in needs_input after refresh', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const task = created.runtime.tasks[0];
    const owner = created.runtime.agents.find((agent) => agent.id === task.ownerAgentId)!;

    const gated = await service.openHumanGate('ws-1', teamId, {
      taskId: task.id,
      agentId: owner.id,
      reason: 'Need lead decision',
      prompt: 'Should the API stay stable?',
    });
    const gate = gated.runtime.humanGates[0];
    const statePath = join(mockState.root, 'ws-1', 'agent-teams', 'state.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    const storedGate = state.humanGates.find((candidate: any) => candidate.id === gate.id);
    storedGate.status = 'answered';
    storedGate.answer = 'Keep the API stable.';
    storedGate.updatedAt = Date.now();
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');

    const freshService = new CanvasAgentTeamsService();
    await freshService.maintainTeam('ws-1', teamId);
    const repaired = await freshService.snapshot('ws-1', teamId);

    expect(repaired.runtime.humanGates[0]).toMatchObject({
      status: 'answered',
      answer: 'Keep the API stable.',
    });
    expect(repaired.runtime.tasks[0].status).toBe('in_progress');
    expect(repaired.runtime.tasks[0].blockedReason).toBeUndefined();
    expect(repaired.runtime.agents.find((agent) => agent.id === owner.id)?.status).toBe('running');
  });

  it('answers the gate for the task named by --task when a teammate has several open questions', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const implement = created.runtime.tasks.find((task) => task.title === 'Implement checkout refactor')!;
    const coder = created.runtime.agents.find((agent) => agent.id === implement.ownerAgentId)!;

    // Give the same teammate a second task so it can hold two open questions.
    const withSecond = await service.createTask({
      workspaceId: 'ws-1',
      teamId,
      title: 'Harden checkout retries',
      description: 'Add retry handling to checkout.',
      ownerName: coder.name,
    });
    const second = withSecond.tasks.find((task) => task.title === 'Harden checkout retries')!;

    await service.openHumanGate('ws-1', teamId, {
      taskId: implement.id,
      agentId: coder.id,
      reason: 'Need a decision',
      prompt: 'Which payment provider should I wire first?',
    });
    const gatedTwice = await service.openHumanGate('ws-1', teamId, {
      taskId: second.id,
      agentId: coder.id,
      reason: 'Need a decision',
      prompt: 'How many retries should checkout attempt?',
    });
    expect(gatedTwice.runtime.humanGates.filter((gate) => gate.status === 'open')).toHaveLength(2);

    // Targeting the second task answers exactly that gate and leaves the other open.
    const answered = await service.sendInput('ws-1', teamId, coder.name, 'Use three retries with backoff.', second.id);
    const implementGate = answered.runtime.humanGates.find((gate) => gate.taskId === implement.id)!;
    const secondGate = answered.runtime.humanGates.find((gate) => gate.taskId === second.id)!;

    expect(secondGate).toMatchObject({ status: 'answered', answer: 'Use three retries with backoff.' });
    expect(implementGate.status).toBe('open');
    expect(mockState.queuedInputs.at(-1)).toEqual({
      workspaceId: 'ws-1',
      nodeId: coder.sessionRef!.sessionId,
      input: 'Use three retries with backoff.',
    });
  });

  it('ignores human-input markers for a task the lead already completed', async () => {
    const service = new CanvasAgentTeamsService();
    const created = await createExecutingTeam(service);
    const teamId = created.runtime.team.id;
    const implement = created.runtime.tasks.find((task) => task.title === 'Implement checkout refactor')!;
    const coder = created.runtime.agents.find((agent) => agent.id === implement.ownerAgentId)!;

    await service.completeAgentTask({
      workspaceId: 'ws-1',
      teamId,
      taskId: implement.id,
      summary: 'Implementation is done.',
    });

    // A late human-input marker for the finished task must not reopen a gate.
    const ignored = await service.reportAgentOutput(
      'ws-1',
      coder.sessionRef!.sessionId,
      `[agent-team:human-input-needed taskId="${implement.id}"] Should I also refactor the helper?\n`,
    );
    expect(ignored).toBeNull();

    const snapshot = await service.snapshot('ws-1', teamId);
    expect(snapshot.runtime.humanGates).toHaveLength(0);
    expect(snapshot.runtime.tasks.find((task) => task.id === implement.id)?.status).toBe('done');
  });
});
