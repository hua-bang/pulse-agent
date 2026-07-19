import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./runtime-control', () => ({
  tryReadRuntime: async () => ({
    ok: true,
    value: {
      pid: 123,
      baseUrl: 'http://127.0.0.1:4567',
      secret: 'secret',
      createdAt: '2026-07-19T00:00:00.000Z',
    },
  }),
}));

import { callRuntimeCapability } from './runtime-capabilities';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('runtime capability transport budget', () => {
  it('keeps a generic page-eval call alive beyond its execution timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>(
      (resolve, reject) => {
        const responseTimer = setTimeout(() => resolve(new Response(JSON.stringify({
          ok: true,
          value: { action: 'page_eval', value: 'done' },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })), 5_500);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(responseTimer);
          reject(new DOMException('aborted', 'AbortError'));
        });
      }
    )));

    const pending = callRuntimeCapability({
      workspaceId: 'ws-1',
      name: 'browser.page.eval',
      input: { nodeId: 'web-1', code: 'return "done"' },
    });
    await Promise.resolve();

    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual({
      ok: true,
      value: { action: 'page_eval', value: 'done' },
    });
  });
});
