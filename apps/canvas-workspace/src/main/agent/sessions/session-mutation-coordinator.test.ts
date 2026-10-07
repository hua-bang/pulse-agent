import { describe, expect, it, vi } from 'vitest';
import { SessionMutationCoordinator } from './session-mutation-coordinator';

vi.mock('./sqlite-session-backend', async importOriginal => ({
  ...await importOriginal<typeof import('./sqlite-session-backend')>(),
  getSqliteSessionStorage: async () => null,
}));

const scope = { kind: 'workspace', workspaceId: 'ws' } as const;

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('SessionMutationCoordinator shutdown', () => {
  it('allows clean-current refresh only while that conversation has no active run', async () => {
    const agent = { getCurrentSessionId: () => 'session' };
    const coordinator = new SessionMutationCoordinator(async () => undefined, () => agent as never);
    const started = gate();
    const finish = gate();
    const run = coordinator.runChat(scope, async () => { started.resolve(); await finish.promise; }, 'session');
    await started.promise;
    const reconcile = vi.fn(async () => undefined);
    await coordinator.reconcileActiveAgent(scope, reconcile);
    expect(reconcile).toHaveBeenLastCalledWith(agent, false);
    finish.resolve();
    await run;
    await coordinator.reconcileActiveAgent(scope, reconcile);
    expect(reconcile).toHaveBeenLastCalledWith(agent, true);
    await coordinator.stopAndDrain();
  });

  it('aborts active runs and waits for their final queued persistence before completing', async () => {
    const abort = vi.fn();
    const coordinator = new SessionMutationCoordinator(async () => undefined, () => ({ abort }) as never);
    const model = gate();
    const write = gate();
    const started = gate();
    const writeStarted = gate();
    const run = coordinator.runChat(scope, async () => {
      started.resolve();
      await model.promise;
      void coordinator.createStoredConversation(scope, async () => {
        writeStarted.resolve();
        await write.promise;
      });
      return 'finished';
    }, 'session');
    await started.promise;

    let drained = false;
    const drain = coordinator.stopAndDrain().then(() => { drained = true; });
    expect(abort).toHaveBeenCalledWith('session');
    const lateRun = vi.fn();
    expect(await coordinator.runChat(scope, lateRun, 'other-session')).toBeNull();
    expect(lateRun).not.toHaveBeenCalled();

    model.resolve();
    await writeStarted.promise;
    expect(await run).toBe('finished');
    expect(drained).toBe(false);
    write.resolve();
    await drain;
    expect(drained).toBe(true);
  });

  it('does not start a chat waiting behind an earlier mutation once shutdown begins', async () => {
    const coordinator = new SessionMutationCoordinator(async () => undefined, () => undefined);
    const write = gate();
    const queuedWrite = coordinator.createStoredConversation(scope, () => write.promise);
    const operation = vi.fn(async () => 'reply');
    const queuedRun = coordinator.runChat(scope, operation, 'session');
    const drain = coordinator.stopAndDrain();
    write.resolve();
    await queuedWrite;
    await drain;
    expect(await queuedRun).toBeNull();
    expect(operation).not.toHaveBeenCalled();
  });
});
