import { describe, expect, it } from 'vitest';
import { TeamRuntime } from '../team-runtime.js';
import { InMemoryTeamRuntimeStore } from '../memory-store.js';
import type {
  AgentSessionAdapter,
  AgentSessionEvent,
  AgentSessionRef,
  CreateAgentSessionInput,
} from '../types.js';

class FakeAgentSessionAdapter implements AgentSessionAdapter {
  sessions = new Map<string, CreateAgentSessionInput>();
  inputs: Array<{ sessionId: string; input: string }> = [];
  interrupts: Array<{ sessionId: string; mode: 'soft' | 'ctrl-c' | 'abort' }> = [];
  private next = 1;
  private handlers = new Set<(event: AgentSessionEvent) => void>();

  async createSession(input: CreateAgentSessionInput): Promise<AgentSessionRef> {
    const sessionId = `session-${this.next++}`;
    this.sessions.set(sessionId, input);
    return { sessionId, provider: 'fake-cli', displayName: input.name };
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    this.inputs.push({ sessionId, input });
  }

  async interrupt(sessionId: string, mode: 'soft' | 'ctrl-c' | 'abort'): Promise<void> {
    this.interrupts.push({ sessionId, mode });
  }

  async getStatus(): Promise<'idle'> {
    return 'idle';
  }

  onEvent(handler: (event: AgentSessionEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(event: AgentSessionEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}

const createRuntime = () => {
  let id = 1;
  let now = 1000;
  const adapter = new FakeAgentSessionAdapter();
  const runtime = new TeamRuntime({
    agentSessions: adapter,
    idFactory: () => `id-${id++}`,
    now: () => now++,
  });
  return { runtime, adapter };
};

describe('TeamRuntime', () => {
  it('creates a team, agents, tasks, and emits events', async () => {
    const { runtime } = createRuntime();
    const snapshot = await runtime.createTeam({
      name: 'Checkout Refactor',
      goal: 'Refactor checkout flow',
    });

    const lead = await runtime.addAgent({
      teamId: snapshot.team.id,
      role: 'lead',
      name: 'Claude Plan',
    });
    const coder = await runtime.addAgent({
      teamId: snapshot.team.id,
      role: 'teammate',
      name: 'Codex Exec',
    });
    const task = await runtime.createTask({
      teamId: snapshot.team.id,
      title: 'Refactor payment flow',
      description: 'Move payment orchestration into a service.',
      ownerAgentId: coder.id,
      createdBy: lead.id,
    });

    const updated = await runtime.snapshot(snapshot.team.id);
    expect(updated.team.leadAgentId).toBe(lead.id);
    expect(updated.agents).toHaveLength(2);
    expect(updated.tasks[0].id).toBe(task.id);
    expect(updated.events.map(event => event.type)).toEqual([
      'team_created',
      'agent_added',
      'agent_added',
      'task_created',
    ]);
  });

  it('dispatches ready tasks to idle teammate sessions', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const agent = await runtime.addAgent({
      teamId: team.id,
      role: 'teammate',
      name: 'Codex Exec',
      cwd: '/repo/app',
    });
    const withSession = await runtime.createAgentSession(agent.id);
    const task = await runtime.createTask({
      teamId: team.id,
      title: 'Implement tests',
      description: 'Add regression tests.',
      ownerAgentId: agent.id,
    });

    const result = await runtime.dispatchReadyTasks(team.id);
    expect(result.assigned).toHaveLength(1);
    expect(result.assigned[0].id).toBe(task.id);

    const snapshot = await runtime.snapshot(team.id);
    expect(snapshot.tasks[0].status).toBe('in_progress');
    expect(snapshot.agents[0].status).toBe('running');
    expect(snapshot.agents[0].currentTaskId).toBe(task.id);
    expect(adapter.inputs).toHaveLength(1);
    expect(adapter.inputs[0].input).toContain('Implement tests');
    expect(adapter.inputs[0].input).toContain('Working directory: /repo/app');
    expect(adapter.sessions.get(withSession.sessionRef!.sessionId)?.cwd).toBe('/repo/app');
    expect(snapshot.messages[0].type).toBe('task_assigned');
  });

  it('waits for dependencies before dispatching a task', async () => {
    const { runtime } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    const first = await runtime.createTask({ teamId: team.id, title: 'First', description: 'Do first' });
    const second = await runtime.createTask({
      teamId: team.id,
      title: 'Second',
      description: 'Do second',
      ownerAgentId: agent.id,
      deps: [first.id],
    });

    let result = await runtime.dispatchReadyTasks(team.id);
    expect(result.assigned.map(task => task.id)).toEqual([first.id]);

    await runtime.completeTask(first.id, 'Done');
    result = await runtime.dispatchReadyTasks(team.id);
    expect(result.assigned.map(task => task.id)).toEqual([second.id]);
  });

  it('includes completed dependency context when dispatching downstream tasks', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    await runtime.createAgentSession(agent.id);
    const backend = await runtime.createTask({
      teamId: team.id,
      title: 'Define backend API',
      description: 'Create the API contract.',
      ownerAgentId: agent.id,
    });
    const frontend = await runtime.createTask({
      teamId: team.id,
      title: 'Build frontend client',
      description: 'Call the backend API from the UI.',
      ownerAgentId: agent.id,
      deps: [backend.id],
    });

    await runtime.dispatchReadyTasks(team.id);
    const upstreamPrompt = adapter.inputs.at(-1)?.input;
    expect(upstreamPrompt).toContain('Scope boundary:');
    expect(upstreamPrompt).toContain('Only complete the assigned task above');
    expect(upstreamPrompt).toContain('Downstream tasks that are not yours yet:');
    expect(upstreamPrompt).toContain('Build frontend client');

    await runtime.completeTask(backend.id, 'API contract: POST /api/tasks accepts { title } and returns { id, title }.', agent.id);
    await runtime.createArtifact({
      teamId: team.id,
      taskId: backend.id,
      agentId: agent.id,
      kind: 'summary',
      title: 'api-contract.md',
      summary: 'Documents the task creation endpoint.',
    });

    const result = await runtime.dispatchReadyTasks(team.id);
    expect(result.assigned.map(task => task.id)).toEqual([frontend.id]);
    expect(adapter.inputs.at(-1)?.input).toContain('Dependency context from completed upstream tasks');
    expect(adapter.inputs.at(-1)?.input).toContain('Define backend API [done]');
    expect(adapter.inputs.at(-1)?.input).toContain('POST /api/tasks');
    expect(adapter.inputs.at(-1)?.input).toContain('api-contract.md');
  });

  it('rejects cyclic task dependencies', async () => {
    const { runtime } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    await runtime.createTask({
      id: 'task-a',
      teamId: team.id,
      title: 'Task A',
      description: 'A depends on B.',
      deps: ['task-b'],
    });

    await expect(runtime.createTask({
      id: 'task-b',
      teamId: team.id,
      title: 'Task B',
      description: 'B depends on A.',
      deps: ['task-a'],
    })).rejects.toThrow('Task dependency cycle detected');
  });

  it('does not dispatch while the team is waiting for approval', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    await runtime.createAgentSession(agent.id);
    await runtime.createTask({
      teamId: team.id,
      title: 'Follow-up change',
      description: 'Make the approved follow-up change.',
      ownerAgentId: agent.id,
    });
    await runtime.setTeamStatus(team.id, 'waiting_approval', 'runtime');

    const result = await runtime.dispatchReadyTasks(team.id);

    expect(result.assigned).toHaveLength(0);
    expect(adapter.inputs).toHaveLength(0);
    expect((await runtime.snapshot(team.id)).tasks[0].status).toBe('todo');
  });

  it('moves finished work to leader review before final team completion', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const lead = await runtime.addAgent({ teamId: team.id, role: 'lead', name: 'Lead' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    await runtime.createAgentSession(lead.id);
    await runtime.createAgentSession(agent.id);
    const first = await runtime.createTask({
      teamId: team.id,
      title: 'Initial task',
      description: 'Finish the initial task.',
      ownerAgentId: agent.id,
    });
    await runtime.dispatchReadyTasks(team.id);
    await runtime.completeTask(first.id, 'Done', agent.id);
    let snapshot = await runtime.snapshot(team.id);
    expect(snapshot.team.status).toBe('reviewing');
    expect(adapter.inputs.at(-1)?.input).toContain('pulse-canvas team complete-team --summary');

    await runtime.completeTeam(team.id, 'The team shipped the requested work.', lead.id);
    snapshot = await runtime.snapshot(team.id);
    expect(snapshot.team.status).toBe('completed');
    expect(snapshot.messages.at(-1)).toMatchObject({
      from: lead.id,
      to: 'all',
      type: 'status_update',
      content: 'The team shipped the requested work.',
    });
  });

  it('returns a reviewed team to running when follow-up work is dispatched', async () => {
    const { runtime } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    await runtime.createAgentSession(agent.id);
    const first = await runtime.createTask({
      teamId: team.id,
      title: 'Initial task',
      description: 'Finish the initial task.',
      ownerAgentId: agent.id,
    });
    await runtime.dispatchReadyTasks(team.id);
    await runtime.completeTask(first.id, 'Done', agent.id);
    expect((await runtime.snapshot(team.id)).team.status).toBe('reviewing');

    await runtime.createTask({
      teamId: team.id,
      title: 'Follow-up task',
      description: 'Do the follow-up.',
      ownerAgentId: agent.id,
    });
    await runtime.dispatchReadyTasks(team.id);

    expect((await runtime.snapshot(team.id)).team.status).toBe('running');
  });

  it('asks the lead to review a task when a session exits without task completion', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const lead = await runtime.addAgent({ teamId: team.id, role: 'lead', name: 'Lead' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    const leadWithSession = await runtime.createAgentSession(lead.id);
    const agentWithSession = await runtime.createAgentSession(agent.id);
    const task = await runtime.createTask({
      teamId: team.id,
      title: 'Implement change',
      description: 'Make the change.',
      ownerAgentId: agent.id,
    });
    const downstream = await runtime.createTask({
      teamId: team.id,
      title: 'QA implemented change',
      description: 'Verify the implemented change.',
      ownerAgentId: agent.id,
      deps: [task.id],
    });

    await runtime.dispatchReadyTasks(team.id);
    adapter.emit({
      sessionId: agentWithSession.sessionRef!.sessionId,
      type: 'completed',
      text: 'Process exited after producing output.',
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    const snapshot = await runtime.snapshot(team.id);
    expect(snapshot.tasks[0]).toMatchObject({
      id: task.id,
      status: 'needs_review',
      blockedReason: 'Process exited after producing output.',
    });
    const owner = snapshot.agents.find(candidate => candidate.id === agent.id);
    expect(owner?.status).toBe('idle');
    expect(owner?.currentTaskId).toBeUndefined();
    expect(adapter.inputs.at(-1)).toMatchObject({
      sessionId: leadWithSession.sessionRef!.sessionId,
    });
    expect(adapter.inputs.at(-1)?.input).toContain('Task needs review: Implement change');
    expect(adapter.inputs.at(-1)?.input).toContain('pulse-canvas team complete-task');
    expect(adapter.inputs.at(-1)?.input).toContain('covers downstream tasks');
    expect(adapter.inputs.at(-1)?.input).toContain('Direct downstream tasks to check');
    expect(adapter.inputs.at(-1)?.input).toContain(`QA implemented change [todo] ID: ${downstream.id}`);
    expect(adapter.inputs.at(-1)?.input).toContain('Do not run sleep, watch, tail, polling loops');
  });

  it('routes generic needs-input session events to task review instead of opening a blank gate', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    const agentWithSession = await runtime.createAgentSession(agent.id);
    const task = await runtime.createTask({
      teamId: team.id,
      title: 'Implement change',
      description: 'Make the change.',
      ownerAgentId: agent.id,
    });

    await runtime.dispatchReadyTasks(team.id);
    adapter.emit({
      sessionId: agentWithSession.sessionRef!.sessionId,
      type: 'needs_input',
      text: 'Agent requested human input.',
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    const snapshot = await runtime.snapshot(team.id);
    expect(snapshot.humanGates).toHaveLength(0);
    expect(snapshot.tasks[0]).toMatchObject({
      id: task.id,
      status: 'needs_review',
      blockedReason: 'Agent requested human input but did not include a concrete question.',
    });
    expect(snapshot.agents[0].status).toBe('idle');
    expect(snapshot.agents[0].currentTaskId).toBeUndefined();
  });

  it('routes concrete teammate needs-input session events to the team lead first', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const lead = await runtime.addAgent({ teamId: team.id, role: 'lead', name: 'Lead' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    const leadWithSession = await runtime.createAgentSession(lead.id);
    const agentWithSession = await runtime.createAgentSession(agent.id);
    const task = await runtime.createTask({
      teamId: team.id,
      title: 'Implement change',
      description: 'Make the change.',
      ownerAgentId: agent.id,
    });

    await runtime.dispatchReadyTasks(team.id);
    adapter.emit({
      sessionId: agentWithSession.sessionRef!.sessionId,
      type: 'needs_input',
      text: 'Should I update the public API?',
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    const snapshot = await runtime.snapshot(team.id);
    expect(snapshot.humanGates).toHaveLength(1);
    expect(snapshot.humanGates[0]).toMatchObject({
      agentId: agent.id,
      taskId: task.id,
      status: 'open',
      prompt: 'Should I update the public API?',
      metadata: { audience: 'lead' },
    });
    expect(snapshot.tasks[0].status).toBe('needs_input');
    expect(snapshot.agents.find(candidate => candidate.id === agent.id)?.status).toBe('needs_input');
    expect(adapter.inputs.at(-1)).toMatchObject({
      sessionId: leadWithSession.sessionRef!.sessionId,
    });
    expect(adapter.inputs.at(-1)?.input).toContain('A teammate needs Team Lead input');
    expect(adapter.inputs.at(-1)?.input).toContain('pulse-canvas team send');
    expect(adapter.inputs.at(-1)?.input).toContain('Ask the human only if');
  });

  it('delivers lead notifications with the pending gate backlog while the lead is already running', async () => {
    let id = 1;
    let now = 1000;
    const store = new InMemoryTeamRuntimeStore();
    const adapter = new FakeAgentSessionAdapter();
    const runtime = new TeamRuntime({
      store,
      agentSessions: adapter,
      idFactory: () => `id-${id++}`,
      now: () => now++,
    });
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const lead = await runtime.addAgent({ teamId: team.id, role: 'lead', name: 'Lead' });
    const coder = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    const qa = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'QA' });
    const leadWithSession = await runtime.createAgentSession(lead.id);
    const implementationTask = await runtime.createTask({
      teamId: team.id,
      title: 'Implement change',
      description: 'Make the change.',
      ownerAgentId: coder.id,
    });
    const qaTask = await runtime.createTask({
      teamId: team.id,
      title: 'Verify behavior',
      description: 'Verify the change.',
      ownerAgentId: qa.id,
      deps: [implementationTask.id],
    });

    leadWithSession.status = 'running';
    await store.saveAgent(leadWithSession);
    await runtime.openHumanGate({
      teamId: team.id,
      agentId: coder.id,
      taskId: implementationTask.id,
      reason: 'Need a design decision',
      prompt: 'Should I expose this as a public API?',
      metadata: { audience: 'lead' },
    });
    await runtime.openHumanGate({
      teamId: team.id,
      agentId: qa.id,
      taskId: qaTask.id,
      reason: 'Need QA scope',
      prompt: 'Should QA cover the fallback path?',
      metadata: { audience: 'lead' },
    });

    const leadInputs = adapter.inputs.filter((entry) => entry.sessionId === leadWithSession.sessionRef!.sessionId);
    expect(leadInputs).toHaveLength(2);
    expect(leadInputs.at(-1)?.input).toContain('Current teammate questions waiting for Team Lead (2):');
    expect(leadInputs.at(-1)?.input).toContain('Coder — Implement change');
    expect(leadInputs.at(-1)?.input).toContain('Should I expose this as a public API?');
    expect(leadInputs.at(-1)?.input).toContain('QA — Verify behavior');
    expect(leadInputs.at(-1)?.input).toContain('Should QA cover the fallback path?');

    await runtime.notifyLeadPendingGates(team.id);
    expect(adapter.inputs.filter((entry) => entry.sessionId === leadWithSession.sessionRef!.sessionId)).toHaveLength(2);
    now += 31_000;
    await runtime.notifyLeadPendingGates(team.id);
    expect(adapter.inputs.filter((entry) => entry.sessionId === leadWithSession.sessionRef!.sessionId)).toHaveLength(3);
    expect(adapter.inputs.at(-1)?.input).toContain('still waiting for Team Lead attention');

    const restartedRuntime = new TeamRuntime({
      store,
      agentSessions: adapter,
      idFactory: () => `id-${id++}`,
      now: () => now++,
    });
    await restartedRuntime.notifyLeadPendingGates(team.id);
    await restartedRuntime.notifyLeadPendingGates(team.id);

    const leadInputsAfterRestart = adapter.inputs.filter((entry) => entry.sessionId === leadWithSession.sessionRef!.sessionId);
    expect(leadInputsAfterRestart).toHaveLength(4);
    expect(leadInputsAfterRestart.at(-1)?.input).toContain('still waiting for Team Lead attention');
    expect(leadInputsAfterRestart.at(-1)?.input).toContain('Current teammate questions waiting for Team Lead (2):');
    const messages = await store.listMessages(team.id);
    expect(messages.at(-1)).toMatchObject({
      to: lead.id,
      type: 'status_update',
    });
  });

  it('opens and answers human gates through mailbox and agent session input', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    const withSession = await runtime.createAgentSession(agent.id);
    const task = await runtime.createTask({
      teamId: team.id,
      title: 'Choose API boundary',
      description: 'Ask human for API boundary.',
      ownerAgentId: agent.id,
    });

    const gateId = await runtime.openHumanGate({
      teamId: team.id,
      agentId: agent.id,
      taskId: task.id,
      reason: 'API boundary unclear',
      prompt: 'Should I keep the public API stable?',
    });

    let snapshot = await runtime.snapshot(team.id);
    expect(snapshot.humanGates[0].status).toBe('open');
    expect(snapshot.tasks[0].status).toBe('needs_input');
    expect(snapshot.agents[0].status).toBe('needs_input');

    await runtime.answerHumanGate(gateId, 'Keep the public API stable.');
    snapshot = await runtime.snapshot(team.id);

    expect(snapshot.humanGates[0].status).toBe('answered');
    expect(snapshot.tasks[0].status).toBe('in_progress');
    expect(snapshot.agents[0].status).toBe('idle');
    expect(adapter.inputs.at(-1)).toEqual({
      sessionId: withSession.sessionRef!.sessionId,
      input: 'Keep the public API stable.',
    });
    expect(snapshot.messages.map(message => message.type)).toContain('answer');
  });

  it('treats direct input to a waiting teammate as the open gate answer', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    const withSession = await runtime.createAgentSession(agent.id);
    const task = await runtime.createTask({
      teamId: team.id,
      title: 'Choose API boundary',
      description: 'Ask for API boundary.',
      ownerAgentId: agent.id,
    });
    await runtime.dispatchReadyTasks(team.id);

    await runtime.openHumanGate({
      teamId: team.id,
      agentId: agent.id,
      taskId: task.id,
      reason: 'API boundary unclear',
      prompt: 'Should I keep the public API stable?',
    });
    await runtime.sendToAgent(agent.id, 'Keep the public API stable.');

    const snapshot = await runtime.snapshot(team.id);
    expect(snapshot.humanGates[0]).toMatchObject({
      status: 'answered',
      answer: 'Keep the public API stable.',
    });
    expect(snapshot.tasks[0].status).toBe('in_progress');
    expect(snapshot.agents[0].status).toBe('running');
    expect(adapter.inputs.at(-1)).toEqual({
      sessionId: withSession.sessionRef!.sessionId,
      input: 'Keep the public API stable.',
    });
  });

  it('marks the owner agent blocked when a running task is blocked', async () => {
    const { runtime } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    const task = await runtime.createTask({
      teamId: team.id,
      title: 'Implement risky change',
      description: 'Make the change.',
      ownerAgentId: agent.id,
    });
    await runtime.dispatchReadyTasks(team.id);

    await runtime.blockTask(task.id, 'Waiting for a decision.', agent.id);
    const snapshot = await runtime.snapshot(team.id);

    expect(snapshot.tasks[0].status).toBe('blocked');
    expect(snapshot.tasks[0].blockedReason).toBe('Waiting for a decision.');
    expect(snapshot.agents[0].status).toBe('blocked');
    expect(snapshot.agents[0].currentTaskId).toBe(task.id);
  });

  it('interrupts a specific teammate session without pausing dispatch globally', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    const withSession = await runtime.createAgentSession(agent.id);

    await runtime.interruptAgent(agent.id, 'ctrl-c', 'Stop and wait for guidance');

    const snapshot = await runtime.snapshot(team.id);
    expect(snapshot.agents[0].status).toBe('needs_input');
    expect(adapter.interrupts).toEqual([
      { sessionId: withSession.sessionRef!.sessionId, mode: 'ctrl-c' },
    ]);
    expect(snapshot.messages[0].type).toBe('interrupt');
  });

  it('pauses the whole team and aborts active sessions', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const lead = await runtime.addAgent({ teamId: team.id, role: 'lead', name: 'Lead' });
    const coder = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    const leadSession = await runtime.createAgentSession(lead.id);
    const coderSession = await runtime.createAgentSession(coder.id);
    const task = await runtime.createTask({
      teamId: team.id,
      title: 'Implement risky change',
      description: 'Make the change.',
      ownerAgentId: coder.id,
    });
    await runtime.dispatchReadyTasks(team.id);
    await runtime.openHumanGate({
      teamId: team.id,
      agentId: coder.id,
      taskId: task.id,
      reason: 'Need a decision',
      prompt: 'Which option should we use?',
    });

    await runtime.pauseTeam(team.id, 'Paused by test.');
    const snapshot = await runtime.snapshot(team.id);

    expect(snapshot.team.status).toBe('paused');
    expect(snapshot.agents.map(agent => agent.status)).toEqual(['stopped', 'stopped']);
    expect(snapshot.tasks[0].status).toBe('blocked');
    expect(snapshot.tasks[0].blockedReason).toBe('Paused by test.');
    expect(snapshot.humanGates[0].status).toBe('cancelled');
    expect(adapter.interrupts).toEqual([
      { sessionId: leadSession.sessionRef!.sessionId, mode: 'abort' },
      { sessionId: coderSession.sessionRef!.sessionId, mode: 'abort' },
    ]);
  });

  it('resumes paused team work and redispatches interrupted tasks', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const lead = await runtime.addAgent({ teamId: team.id, role: 'lead', name: 'Lead' });
    const coder = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    await runtime.createAgentSession(lead.id);
    const coderSession = await runtime.createAgentSession(coder.id);
    const task = await runtime.createTask({
      teamId: team.id,
      title: 'Implement resumable change',
      description: 'Make the resumable change.',
      ownerAgentId: coder.id,
    });

    await runtime.dispatchReadyTasks(team.id);
    await runtime.pauseTeam(team.id, 'Paused by test.');
    let snapshot = await runtime.snapshot(team.id);
    expect(snapshot.team.status).toBe('paused');
    expect(snapshot.tasks[0]).toMatchObject({
      status: 'blocked',
      blockedReason: 'Paused by test.',
    });
    expect(snapshot.tasks[0].metadata?.teamPause).toMatchObject({
      previousStatus: 'in_progress',
      reason: 'Paused by test.',
    });

    await runtime.resumeTeam(team.id, 'Resumed by test.');
    const result = await runtime.dispatchReadyTasks(team.id);

    expect(result.assigned.map(assigned => assigned.id)).toEqual([task.id]);
    snapshot = await runtime.snapshot(team.id);
    expect(snapshot.team.status).toBe('running');
    expect(snapshot.tasks[0].status).toBe('in_progress');
    expect(snapshot.tasks[0].blockedReason).toBeUndefined();
    expect(snapshot.tasks[0].metadata?.teamPause).toBeUndefined();
    expect(snapshot.agents.find(agent => agent.id === lead.id)?.status).toBe('idle');
    expect(snapshot.agents.find(agent => agent.id === coder.id)).toMatchObject({
      status: 'running',
      currentTaskId: task.id,
    });
    expect(snapshot.agents.every(agent => !agent.metadata?.teamPause)).toBe(true);
    expect(adapter.inputs).toHaveLength(2);
    expect(adapter.inputs.at(-1)).toMatchObject({
      sessionId: coderSession.sessionRef!.sessionId,
    });
    expect(adapter.inputs.at(-1)?.input).toContain('Implement resumable change');
    expect(snapshot.events.map(event => event.type)).toContain('dispatch_resumed');
  });

  it('deletes a team and aborts its sessions', async () => {
    const { runtime, adapter } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const agent = await runtime.addAgent({ teamId: team.id, role: 'teammate', name: 'Coder' });
    const withSession = await runtime.createAgentSession(agent.id);
    await runtime.createTask({
      teamId: team.id,
      title: 'Implement risky change',
      description: 'Make the change.',
      ownerAgentId: agent.id,
    });

    await runtime.deleteTeam(team.id);

    expect(adapter.interrupts).toEqual([
      { sessionId: withSession.sessionRef!.sessionId, mode: 'abort' },
    ]);
    await expect(runtime.snapshot(team.id)).rejects.toThrow('Team not found');
  });

  it('keeps artifacts lightweight and evented', async () => {
    const { runtime } = createRuntime();
    const { team } = await runtime.createTeam({ name: 'Team', goal: 'Ship it' });
    const artifact = await runtime.createArtifact({
      teamId: team.id,
      kind: 'diff',
      title: 'checkout-refactor.diff',
      summary: 'Payment flow changes',
    });

    const snapshot = await runtime.snapshot(team.id);
    expect(snapshot.artifacts).toEqual([artifact]);
    expect(snapshot.events.at(-1)!.type).toBe('artifact_created');
  });
});
