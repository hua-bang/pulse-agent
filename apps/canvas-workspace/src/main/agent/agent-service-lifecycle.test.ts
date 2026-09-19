import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('./service', () => ({ CanvasAgentService: mocks.create }));

import { getCanvasAgentService, teardownCanvasAgentServices } from './agent-service-lifecycle';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function nextService() {
  const drain = deferred();
  const deactivateAll = vi.fn(() => drain.promise);
  mocks.create.mockImplementationOnce(() => ({ deactivateAll }));
  const service = getCanvasAgentService();
  return { service, deactivateAll, drain };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('Canvas Agent service lifecycle', () => {
  it('keeps a window-close drain awaitable when before-quit calls teardown again', async () => {
    const first = nextService();
    const windowClose = teardownCanvasAgentServices();
    let quitFinished = false;
    const quit = teardownCanvasAgentServices().then(() => { quitFinished = true; });
    await Promise.resolve();
    expect(first.deactivateAll).toHaveBeenCalledOnce();
    expect(quitFinished).toBe(false);
    first.drain.resolve();
    await Promise.all([windowClose, quit]);
    expect(quitFinished).toBe(true);
  });

  it('waits for all service batches after reopening and closing windows on macOS', async () => {
    const first = nextService();
    const firstClose = teardownCanvasAgentServices();
    const reopened = nextService();
    expect(reopened.service).not.toBe(first.service);
    expect(getCanvasAgentService()).toBe(reopened.service);
    const secondClose = teardownCanvasAgentServices();
    let quitFinished = false;
    const quit = teardownCanvasAgentServices().then(() => { quitFinished = true; });
    await Promise.resolve();
    expect(first.deactivateAll).toHaveBeenCalledOnce();
    expect(reopened.deactivateAll).toHaveBeenCalledOnce();
    reopened.drain.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(quitFinished).toBe(false);
    first.drain.resolve();
    await Promise.all([firstClose, secondClose, quit]);
    expect(quitFinished).toBe(true);
  });

  it('waits for other batches when one drain fails, then propagates that failure', async () => {
    const first = nextService();
    const firstClose = teardownCanvasAgentServices();
    const reopened = nextService();
    const secondClose = teardownCanvasAgentServices();
    let quitSettled = false;
    const quit = teardownCanvasAgentServices();
    void quit.then(() => { quitSettled = true; }, () => { quitSettled = true; });
    const results = Promise.allSettled([firstClose, secondClose, quit]);
    await Promise.resolve();
    first.drain.reject(new Error('Could not archive first service'));
    await Promise.resolve();
    await Promise.resolve();
    expect(quitSettled).toBe(false);
    reopened.drain.resolve();
    expect(await results).toEqual(Array.from({ length: 3 }, () => ({
      status: 'rejected', reason: new Error('Could not archive first service'),
    })));
  });
});
