import { describe, expect, it, vi } from 'vitest';
import { repairAgentTeamState } from './state-repairs';

const makeStore = (tasks: any[], agents: any[], gates: any[]) => ({
  listTasks: vi.fn(async () => tasks),
  listAgents: vi.fn(async () => agents),
  listHumanGates: vi.fn(async () => gates),
  saveTask: vi.fn(async () => undefined),
  saveAgent: vi.fn(async () => undefined),
  saveHumanGate: vi.fn(async () => undefined),
});

describe('repairAgentTeamState', () => {
  it('resumes legacy output-marker blocks held by their owner', async () => {
    const task = {
      id: 'task-1', status: 'blocked', blockedReason: 'Blocked by agent output marker.', ownerAgentId: 'agent-1',
    };
    const agent = { id: 'agent-1', status: 'blocked', currentTaskId: 'task-1' };
    const store = makeStore([task], [agent], []);

    await repairAgentTeamState(store as never, 'team-1');

    expect(task).toMatchObject({ status: 'in_progress', blockedReason: undefined });
    expect(agent).toMatchObject({ status: 'running' });
    expect(store.saveTask).toHaveBeenCalledWith(task);
    expect(store.saveAgent).toHaveBeenCalledWith(agent);
  });

  it('resumes answered gates only when no open gate remains for the task', async () => {
    const task = { id: 'task-1', status: 'needs_input', blockedReason: 'waiting', ownerAgentId: 'agent-1' };
    const agent = { id: 'agent-1', status: 'needs_input', currentTaskId: 'task-1' };
    const gates = [{ id: 'gate-1', status: 'answered', taskId: 'task-1', agentId: 'agent-1', prompt: 'Question?' }];
    const store = makeStore([task], [agent], gates);

    await repairAgentTeamState(store as never, 'team-1');

    expect(task).toMatchObject({ status: 'in_progress', blockedReason: undefined });
    expect(agent).toMatchObject({ status: 'running' });
  });

  it('does not resume an answered task while another gate for it remains open', async () => {
    const task = { id: 'task-1', status: 'needs_input', blockedReason: 'waiting', ownerAgentId: 'agent-1' };
    const agent = { id: 'agent-1', status: 'needs_input', currentTaskId: 'task-1' };
    const gates = [
      { id: 'gate-1', status: 'answered', taskId: 'task-1', agentId: 'agent-1', prompt: 'First question?' },
      { id: 'gate-2', status: 'open', taskId: 'task-1', agentId: 'agent-1', prompt: 'Second question?' },
    ];
    const store = makeStore([task], [agent], gates);

    await repairAgentTeamState(store as never, 'team-1');

    expect(task).toMatchObject({ status: 'needs_input', blockedReason: 'waiting' });
    expect(agent).toMatchObject({ status: 'needs_input' });
    expect(store.saveTask).not.toHaveBeenCalled();
    expect(store.saveAgent).not.toHaveBeenCalled();
  });

  it('cancels placeholder gates without resuming records protected by another open gate', async () => {
    const task = { id: 'task-1', status: 'needs_input', ownerAgentId: 'agent-1' };
    const agent = { id: 'agent-1', status: 'needs_input', currentTaskId: 'task-1' };
    const placeholder = {
      id: 'gate-1', status: 'open', taskId: 'task-1', agentId: 'agent-1', prompt: 'Agent requested human input.',
    };
    const concrete = {
      id: 'gate-2', status: 'open', taskId: 'task-1', agentId: 'agent-1', prompt: 'Keep the API stable?',
    };
    const store = makeStore([task], [agent], [placeholder, concrete]);

    await repairAgentTeamState(store as never, 'team-1');

    expect(placeholder).toMatchObject({ status: 'cancelled' });
    expect(concrete).toMatchObject({ status: 'open' });
    expect(task).toMatchObject({ status: 'needs_input' });
    expect(agent).toMatchObject({ status: 'needs_input' });
  });

  it('runs legacy, answered-gate, then placeholder-gate reads in order', async () => {
    const calls: string[] = [];
    const store = {
      listTasks: vi.fn(async () => { calls.push('tasks'); return []; }),
      listAgents: vi.fn(async () => { calls.push('agents'); return []; }),
      listHumanGates: vi.fn(async () => { calls.push('gates'); return []; }),
      saveTask: vi.fn(),
      saveAgent: vi.fn(),
      saveHumanGate: vi.fn(),
    };

    await repairAgentTeamState(store as never, 'team-1');

    expect(calls).toEqual(['tasks', 'agents', 'gates', 'tasks', 'agents', 'gates']);
  });
});
