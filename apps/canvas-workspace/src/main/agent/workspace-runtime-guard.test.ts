import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionMutationCoordinator } from './session-mutation-coordinator';
import { assertWorkspaceAvailable, registerWorkspaceSessionDrain, withWorkspaceRun, withWorkspaceTrashGuard } from './workspace-runtime-guard';
import { readCanvasAgentHistorySnapshot } from './history-snapshot';
import { activateAgentScope } from './scope-agent-activation';
import { ScopeActivationGate } from './scope-activation-gate';
import type { CanvasAgent } from './canvas-agent';
import { appendActiveSessionGroups } from './active-session-groups';

const state = vi.hoisted(() => ({
  trashed: false,
  initialize: vi.fn(async () => undefined),
  destroy: vi.fn(async () => undefined),
}));
vi.mock('./sqlite-session-backend', async importOriginal => ({
  ...await importOriginal<typeof import('./sqlite-session-backend')>(),
  getSqliteSessionStorage: async () => ({
    workspaces: { getTrashed: async () => state.trashed ? { workspaceId: 'ws' } : null },
  }),
}));
vi.mock('./canvas-agent', () => ({
  CanvasAgent: vi.fn().mockImplementation(() => ({ initialize: state.initialize, destroy: state.destroy })),
}));

const scope = { kind: 'workspace', workspaceId: 'ws' } as const;
const coordinators: SessionMutationCoordinator[] = [];
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => {
  state.trashed = false;
  state.initialize.mockReset().mockResolvedValue(undefined);
  state.destroy.mockClear();
});
afterEach(async () => {
  await Promise.all(coordinators.splice(0).map(coordinator => coordinator.stopAndDrain()));
});

describe('workspace runtime trash boundary', () => {
  it('refuses trash while a conversation is running without stopping it', async () => {
    const started = gate();
    const finish = gate();
    const run = withWorkspaceRun(scope, async () => { started.resolve(); await finish.promise; return 'done'; });
    await started.promise;
    const trash = vi.fn();
    await expect(withWorkspaceTrashGuard('ws', trash)).rejects.toMatchObject({ code: 'storage_busy' });
    expect(trash).not.toHaveBeenCalled();
    finish.resolve();
    expect(await run).toBe('done');
  });

  it('drains queued appends from every coordinator before trash and blocks new runs throughout', async () => {
    const writes = [gate(), gate()];
    const started = [gate(), gate()];
    const persisted: number[] = [];
    for (let index = 0; index < 2; index += 1) {
      const coordinator = new SessionMutationCoordinator(async () => undefined, () => ({
        appendToSession: async () => {
          started[index].resolve();
          await writes[index].promise;
          persisted.push(index);
        },
      }) as never);
      coordinators.push(coordinator);
      coordinator.enqueueSessionAppend(scope, 'session', [{ role: 'user', content: 'last message', timestamp: 1 }]);
    }
    await Promise.all(started.map(item => item.promise));
    const trash = vi.fn(async () => { expect(persisted).toEqual([0, 1]); state.trashed = true; });
    const deletion = withWorkspaceTrashGuard('ws', trash);
    const lateRun = vi.fn();
    expect(await coordinators[0].runChat(scope, lateRun, 'late')).toBeNull();
    writes[0].resolve();
    await coordinators[0].waitForIdle(scope);
    expect(trash).not.toHaveBeenCalled();
    writes[1].resolve();
    await deletion;
    expect(trash).toHaveBeenCalledOnce();
    expect(lateRun).not.toHaveBeenCalled();
  });

  it('releases the barrier after a failed drain without running the trash operation', async () => {
    const dispose = registerWorkspaceSessionDrain(async () => { throw new Error('could not flush'); });
    const trash = vi.fn();
    await expect(withWorkspaceTrashGuard('ws', trash)).rejects.toThrow('could not flush');
    expect(trash).not.toHaveBeenCalled();
    dispose();
    expect(await withWorkspaceRun(scope, async () => 'available')).toBe('available');
  });

  it('checks a CLI tombstone before returning cached history or starting a new run', async () => {
    state.trashed = true;
    const agent = { getHistory: vi.fn(() => []), getCurrentSessionId: vi.fn(() => 'cached') };
    expect(await readCanvasAgentHistorySnapshot(scope, agent)).toEqual({ messages: [], activeSessionId: null });
    expect(agent.getHistory).not.toHaveBeenCalled();
    await expect(withWorkspaceRun(scope, vi.fn())).rejects.toMatchObject({ code: 'not_found' });
    await expect(assertWorkspaceAvailable({ kind: 'global' })).resolves.toBeUndefined();
  });

  it('does not re-list a cached Agent from a stale renderer workspace-name map', async () => {
    state.trashed = true;
    const listSessions = vi.fn(async () => [{ sessionId: 'cached' }]);
    const groups: Parameters<typeof appendActiveSessionGroups>[0]['groups'] = [];
    await appendActiveSessionGroups({
      agents: new Map([['workspace:ws', { listSessions } as unknown as CanvasAgent]]),
      groups, includedStoreIds: new Set(), scheduledTitles: new Map(), workspaceNames: { ws: 'Old visible name' },
    });
    expect(groups).toEqual([]);
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('checks visibility before returning a cached Agent and after awaited initialization', async () => {
    const agents = new Map<string, CanvasAgent>();
    const activation = new ScopeActivationGate();
    await activateAgentScope(scope, agents, activation);
    state.trashed = true;
    await expect(activateAgentScope(scope, agents, activation)).rejects.toMatchObject({ code: 'not_found' });
    expect(state.initialize).toHaveBeenCalledOnce();

    state.trashed = false;
    agents.clear();
    const started = gate();
    const finish = gate();
    state.initialize.mockImplementationOnce(async () => { started.resolve(); await finish.promise; });
    const pending = activateAgentScope(scope, agents, activation);
    await started.promise;
    state.trashed = true;
    finish.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'not_found' });
    expect(agents.size).toBe(0);
    expect(state.destroy).toHaveBeenCalledOnce();
  });
});
