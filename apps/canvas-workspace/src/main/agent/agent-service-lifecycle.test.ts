import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('./service', () => ({ CanvasAgentService: mocks.create }));

import {
  getCanvasAgentService,
  peekCanvasAgentService,
  teardownCanvasAgentServices,
} from './agent-service-lifecycle';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function nextService() {
  const drain = deferred();
  const deactivateAll = vi.fn(() => drain.promise);
  mocks.create.mockImplementationOnce(() => ({ deactivateAll }));
  const service = await getCanvasAgentService();
  return { service, deactivateAll, drain };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => { vi.clearAllMocks(); });

describe('Canvas Agent service lifecycle', () => {
  it('loads one service on first use and shares it with concurrent callers', async () => {
    mocks.create.mockImplementationOnce(() => ({ deactivateAll: vi.fn() }));
    expect(peekCanvasAgentService()).toBeNull();
    const [first, second] = await Promise.all([getCanvasAgentService(), getCanvasAgentService()]);
    expect(first).toBe(second);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(peekCanvasAgentService()).toBe(first);
    await teardownCanvasAgentServices();
    expect(peekCanvasAgentService()).toBeNull();
  });

  it('keeps a window-close drain awaitable when before-quit calls teardown again', async () => {
    const first = await nextService();
    const windowClose = teardownCanvasAgentServices();
    let quitFinished = false;
    const quit = teardownCanvasAgentServices().then(() => { quitFinished = true; });
    await settle();
    expect(first.deactivateAll).toHaveBeenCalledOnce();
    expect(quitFinished).toBe(false);
    first.drain.resolve();
    await Promise.all([windowClose, quit]);
    expect(quitFinished).toBe(true);
  });

  it('waits for all service batches after reopening and closing windows on macOS', async () => {
    const first = await nextService();
    const firstClose = teardownCanvasAgentServices();
    const reopened = await nextService();
    expect(reopened.service).not.toBe(first.service);
    expect(await getCanvasAgentService()).toBe(reopened.service);
    const secondClose = teardownCanvasAgentServices();
    let quitFinished = false;
    const quit = teardownCanvasAgentServices().then(() => { quitFinished = true; });
    await settle();
    expect(first.deactivateAll).toHaveBeenCalledOnce();
    expect(reopened.deactivateAll).toHaveBeenCalledOnce();
    reopened.drain.resolve();
    await settle();
    expect(quitFinished).toBe(false);
    first.drain.resolve();
    await Promise.all([firstClose, secondClose, quit]);
    expect(quitFinished).toBe(true);
  });

  it('waits for other batches when one drain fails, then propagates that failure', async () => {
    const first = await nextService();
    const firstClose = teardownCanvasAgentServices();
    const reopened = await nextService();
    const secondClose = teardownCanvasAgentServices();
    let quitSettled = false;
    const quit = teardownCanvasAgentServices();
    void quit.then(() => { quitSettled = true; }, () => { quitSettled = true; });
    const results = Promise.allSettled([firstClose, secondClose, quit]);
    await settle();
    first.drain.reject(new Error('Could not archive first service'));
    await settle();
    expect(quitSettled).toBe(false);
    reopened.drain.resolve();
    expect(await results).toEqual(Array.from({ length: 3 }, () => ({
      status: 'rejected', reason: new Error('Could not archive first service'),
    })));
  });
});
