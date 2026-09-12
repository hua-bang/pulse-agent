import { describe, expect, it, vi } from 'vitest';
import type { AgentScope, PluginStore } from '../../../types';
import type { ConversationRuntimeService } from '../../../../main/agent/conversation-runtime/conversation-service';
import { SessionRouter } from '../core/sessions';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

function memoryStore(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  const store: PluginStore = {
    async get<T>(key: string) { return values.get(key) as T | undefined; },
    async set<T>(key: string, value: T) { values.set(key, value); },
    async delete(key: string) { values.delete(key); },
    async list() { return Array.from(values.keys()); },
  };
  return { store, values };
}

function fakeRuntime(options: {
  known?: string[];
  provision?: () => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
} = {}) {
  const known = new Set(options.known ?? []);
  let counter = 0;
  const provisionSession = vi.fn(options.provision ?? (async () => {
    const sessionId = `fresh-${++counter}`;
    known.add(sessionId);
    return { ok: true, sessionId };
  }));
  const copySessionToScope = vi.fn(async (_source, sessionId: string) => {
    if (!known.has(sessionId)) return { ok: false, error: 'Source session not found' };
    const copied = `copy-${++counter}`;
    known.add(copied);
    return { ok: true, sessionId: copied, messageCount: 3 };
  });
  const runtime = {
    provisionSession,
    hasSession: vi.fn(async (_scope, sessionId: string) => known.has(sessionId)),
    copySessionToScope,
    abort: vi.fn(() => true),
  } as unknown as ConversationRuntimeService;
  return { runtime, known, provisionSession, copySessionToScope };
}

const workspace: AgentScope = { kind: 'workspace', workspaceId: 'ws1' };

describe('SessionRouter', () => {
  it('provisions independent sessions per channel and conversation without a UI pointer', async () => {
    const { store } = memoryStore();
    const { runtime } = fakeRuntime();
    const router = new SessionRouter(runtime, store);

    const a = await router.ensureSession(workspace, 'feishu', 'topic-a');
    const b = await router.ensureSession(workspace, 'feishu', 'topic-b');
    const otherChannel = await router.ensureSession(workspace, 'slack', 'topic-a');

    expect(new Set([a, b, otherChannel]).size).toBe(3);
    expect(await router.ensureSession(workspace, 'feishu', 'topic-a')).toBe(a);
  });

  it('single-flights concurrent provisioning for the same route', async () => {
    const gate = deferred<{ ok: boolean; sessionId: string }>();
    const { runtime, known, provisionSession } = fakeRuntime({
      provision: async () => {
        const result = await gate.promise;
        known.add(result.sessionId);
        return result;
      },
    });
    const { store } = memoryStore();
    const router = new SessionRouter(runtime, store);

    const first = router.ensureSession(workspace, 'feishu', 'topic-a');
    const second = router.ensureSession(workspace, 'feishu', 'topic-a');
    await Promise.resolve();
    gate.resolve({ ok: true, sessionId: 'one-session' });

    await expect(Promise.all([first, second])).resolves.toEqual(['one-session', 'one-session']);
    expect(provisionSession).toHaveBeenCalledTimes(1);
  });

  it('fails closed when provisioning fails instead of binding an old session', async () => {
    const { store, values } = memoryStore();
    const { runtime } = fakeRuntime({
      known: ['old-current'],
      provision: async () => ({ ok: false, error: 'create failed' }),
    });
    const router = new SessionRouter(runtime, store);

    await expect(router.ensureSession(workspace, 'feishu', 'topic-a')).rejects.toThrow('create failed');
    expect(await router.getConversationSessionId(workspace, 'feishu', 'topic-a')).toBeUndefined();
    expect(values.get('sessions')).toBeUndefined();
  });

  it('single-flights initialization and serializes concurrent persistence', async () => {
    const load = deferred<Record<string, string>>();
    const persisted: Array<Record<string, string>> = [];
    const store: PluginStore = {
      get: vi.fn(async () => load.promise) as PluginStore['get'],
      set: vi.fn(async (_key, value) => {
        persisted.push({ ...(value as Record<string, string>) });
      }),
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
    };
    const { runtime, known } = fakeRuntime({ known: ['session-a', 'session-b'] });
    known.add('session-a');
    known.add('session-b');
    const router = new SessionRouter(runtime, store);

    const a = router.setConversationSession(workspace, 'feishu', 'topic-a', 'session-a');
    const b = router.setConversationSession(workspace, 'feishu', 'topic-b', 'session-b');
    await Promise.resolve();
    load.resolve({});
    await Promise.all([a, b]);

    expect(store.get).toHaveBeenCalledTimes(1);
    expect(persisted.at(-1)).toEqual({
      'workspace:ws1::feishu::topic-a': 'session-a',
      'workspace:ws1::feishu::topic-b': 'session-b',
    });
  });

  it('reads a legacy scope::conversation mapping and persists the channel-qualified key', async () => {
    const { store, values } = memoryStore({
      sessions: { 'workspace:ws1::topic-a': 'legacy-session' },
    });
    const { runtime } = fakeRuntime({ known: ['legacy-session'] });
    const router = new SessionRouter(runtime, store);

    await expect(router.ensureSession(workspace, 'feishu', 'topic-a')).resolves.toBe('legacy-session');
    expect(values.get('sessions')).toEqual({
      'workspace:ws1::topic-a': 'legacy-session',
      'workspace:ws1::feishu::topic-a': 'legacy-session',
    });
  });

  it('forks duplicate historical mappings without deleting the original history', async () => {
    const { store, values } = memoryStore({
      sessions: {
        'workspace:ws1::feishu::topic-a': 'shared-session',
        'workspace:ws1::feishu::topic-b': 'shared-session',
      },
    });
    const { runtime, copySessionToScope } = fakeRuntime({ known: ['shared-session'] });
    const router = new SessionRouter(runtime, store);

    expect(await router.ensureSession(workspace, 'feishu', 'topic-a')).toBe('shared-session');
    const isolated = await router.ensureSession(workspace, 'feishu', 'topic-b');

    expect(isolated).toBe('copy-1');
    expect(copySessionToScope).toHaveBeenCalledWith(workspace, 'shared-session', workspace);
    expect(values.get('sessions')).toEqual({
      'workspace:ws1::feishu::topic-a': 'shared-session',
      'workspace:ws1::feishu::topic-b': 'copy-1',
    });
  });

  it('replaces a stale mapping only after a fresh session is durable', async () => {
    const { store, values } = memoryStore({
      sessions: { 'workspace:ws1::feishu::topic-a': 'missing-session' },
    });
    const { runtime } = fakeRuntime();
    const router = new SessionRouter(runtime, store);

    await expect(router.ensureSession(workspace, 'feishu', 'topic-a')).resolves.toBe('fresh-1');
    expect(values.get('sessions')).toEqual({
      'workspace:ws1::feishu::topic-a': 'fresh-1',
    });
  });

  it('retains the previous mapping if saving a replacement fails', async () => {
    const { store, values } = memoryStore({
      sessions: { 'workspace:ws1::feishu::topic-a': 'original' },
    });
    const { runtime } = fakeRuntime({ known: ['original'] });
    const router = new SessionRouter(runtime, store);
    vi.spyOn(store, 'set').mockRejectedValueOnce(new Error('store unavailable'));
    await expect(router.createFreshSession(workspace, 'feishu', 'topic-a')).rejects.toThrow('store unavailable');
    expect(await router.getConversationSessionId(workspace, 'feishu', 'topic-a')).toBe('original');
    expect(values.get('sessions')).toEqual({ 'workspace:ws1::feishu::topic-a': 'original' });
  });

  it('targets abort to an explicit conversation session', () => {
    const { store } = memoryStore();
    const { runtime } = fakeRuntime();
    const router = new SessionRouter(runtime, store);

    expect(router.abort(workspace, 'session-a')).toBe(true);
    expect(runtime.abort).toHaveBeenCalledWith(workspace, 'session-a');
  });
});
