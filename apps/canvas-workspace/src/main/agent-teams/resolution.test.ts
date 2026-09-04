import { describe, expect, it } from 'vitest';
import {
  resolveAgentReference,
  resolveOpenGateForAgent,
  resolveTaskForAction,
  resolveTaskReferences,
} from './resolution';

const agents = [
  { id: 'a1', name: 'Builder', currentTaskId: 't1' },
  { id: 'a2', name: 'Reviewer' },
];
const tasks = [
  { id: 't1', title: 'Build', status: 'needs_input', ownerAgentId: 'a1' },
  { id: 't2', title: 'Review', status: 'todo', ownerAgentId: 'a2' },
];

describe('agent team reference resolution', () => {
  it('resolves agents and tasks by exact id or case-insensitive name', () => {
    expect(resolveAgentReference(agents as never, 'a1').id).toBe('a1');
    expect(resolveAgentReference(agents as never, ' reviewer ').id).toBe('a2');
    expect(resolveTaskReferences(tasks as never, ['t1', ' review '])).toEqual(['t1', 't2']);
    expect(resolveTaskForAction(tasks as never, undefined, agents[0] as never).id).toBe('t1');
  });

  it('rejects missing and ambiguous references', () => {
    expect(() => resolveAgentReference(agents as never, '')).toThrow(/required/);
    expect(() => resolveAgentReference(
      [...agents, { ...agents[0], id: 'a3' }] as never,
      'Builder',
    )).toThrow(/ambiguous/);
    expect(() => resolveTaskReferences(tasks as never, ['missing'])).toThrow(/not found/);
  });

  it('prioritizes explicit, current-task, and unique needs-input gates', () => {
    const snapshot = {
      tasks,
      humanGates: [
        { id: 'g1', status: 'open', agentId: 'a1', taskId: 't1' },
        { id: 'g2', status: 'open', agentId: 'a1', taskId: 't2' },
      ],
    };
    expect(resolveOpenGateForAgent(snapshot as never, agents[0] as never, 't2')?.id).toBe('g2');
    expect(resolveOpenGateForAgent(snapshot as never, agents[0] as never)?.id).toBe('g1');
    expect(resolveOpenGateForAgent(snapshot as never, agents[0] as never, 'missing')).toBeUndefined();

    const noCurrentTaskAgent = { id: 'a1', name: 'Builder' } as never;
    expect(resolveOpenGateForAgent(snapshot as never, noCurrentTaskAgent)?.id).toBe('g1');

    const soleOpen = {
      tasks: [{ ...tasks[1], status: 'todo' }],
      humanGates: [{ id: 'sole', status: 'open', agentId: 'a1', taskId: 'other' }],
    } as never;
    expect(resolveOpenGateForAgent(soleOpen, noCurrentTaskAgent)?.id).toBe('sole');

    const ambiguous = {
      tasks: tasks.map((task) => ({ ...task, status: 'todo' })),
      humanGates: snapshot.humanGates,
    } as never;
    expect(resolveOpenGateForAgent(ambiguous, noCurrentTaskAgent)).toBeUndefined();
  });
});
