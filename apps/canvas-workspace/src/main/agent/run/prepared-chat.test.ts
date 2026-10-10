import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  freezePreparedChatModel,
  PreparedChatRegistry,
  startPreparedChat,
} from './prepared-chat';

const sender = (id: number): WebContents => ({
  id,
  isDestroyed: () => false,
  send: vi.fn(),
}) as unknown as WebContents;

afterEach(() => {
  vi.useRealTimers();
});

describe('PreparedChatRegistry', () => {
  it('binds a prepared turn to its renderer and consumes it once', () => {
    const registry = new PreparedChatRegistry();
    const owner = sender(1);
    const other = sender(2);
    const prepared = registry.prepare(owner, { kind: 'global' }, { message: 'hello' });

    expect(registry.take(prepared.sessionId, other)).toBeNull();
    expect(registry.take(prepared.sessionId, owner)).toMatchObject({
      sessionId: prepared.sessionId,
      scope: { kind: 'global' },
      payload: { message: 'hello' },
    });
    expect(registry.take(prepared.sessionId, owner)).toBeNull();
  });

  it('expires a turn that was prepared but never started', () => {
    vi.useFakeTimers();
    const registry = new PreparedChatRegistry(100);
    const owner = sender(1);
    const prepared = registry.prepare(owner, { kind: 'global' }, { message: 'hello' });

    vi.advanceTimersByTime(101);

    expect(registry.take(prepared.sessionId, owner)).toBeNull();
  });

  it('releases the scope reservation when a prepared turn expires or is discarded', () => {
    vi.useFakeTimers();
    const registry = new PreparedChatRegistry(100);
    const owner = sender(1);
    const release = vi.fn();
    const expired = registry.prepare(
      owner,
      { kind: 'global' },
      { message: 'expire' },
      release,
    );

    vi.advanceTimersByTime(101);
    expect(release).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expired.sessionId,
    }));

    const discarded = registry.prepare(
      owner,
      { kind: 'global' },
      { message: 'discard' },
      release,
    );
    expect(registry.discard(discarded.sessionId)).toBe(true);
    expect(release).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: discarded.sessionId,
    }));
  });
});

describe('startPreparedChat', () => {
  it('freezes the main-resolved model into the persisted turn snapshot', () => {
    const registry = new PreparedChatRegistry();
    const owner = sender(9);
    const turn = registry.prepare(owner, { kind: 'global' }, {
      message: 'which model?',
      requestContext: {
        contextSnapshot: {
          scope: { kind: 'global' },
          scopeLabel: 'Global',
          executionMode: 'auto',
          modelLabel: 'stale renderer label',
          capturedAt: 1,
        },
      },
    });

    const resolution = freezePreparedChatModel(turn, {
      providerId: 'provider-real',
      providerName: 'Provider Real',
      providerType: 'openai',
      provider: (() => undefined) as never,
      model: 'model-real',
      modelLabel: 'Model Real',
      modelType: 'openai',
    });

    expect(resolution).toEqual({
      modelProvider: 'provider-real',
      modelId: 'model-real',
      modelLabel: 'Model Real',
    });
    expect(turn.payload.requestContext?.contextSnapshot).toMatchObject(resolution);
  });

  it('forwards a run abort that was latched before scope activation', async () => {
    const owner = sender(3);
    const controller = new AbortController();
    controller.abort();
    const chatWithScope = vi.fn(async (...args: unknown[]) => {
      const signal = args.find((arg): arg is AbortSignal => arg instanceof AbortSignal);
      return { ok: true, response: '', stopped: signal?.aborted };
    });
    let settle: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });

    startPreparedChat(
      { chatWithScope } as unknown as Parameters<typeof startPreparedChat>[0],
      {
        sessionId: 'run-aborted-before-activation',
        sender: owner,
        scope: { kind: 'global' },
        payload: { message: 'stop now' },
      },
      controller.signal,
      () => settle?.(),
    );
    await settled;

    expect(chatWithScope.mock.calls[0]).toContain(controller.signal);
    expect(owner.send).toHaveBeenCalledWith(
      'canvas-agent:chat-complete:run-aborted-before-activation',
      { ok: true, response: '', stopped: true },
    );
  });
});
