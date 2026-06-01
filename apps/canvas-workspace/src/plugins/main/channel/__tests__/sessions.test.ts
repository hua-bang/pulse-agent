import { describe, it, expect, vi } from 'vitest';
import type {
  AgentChatResult,
  AgentSessionInfo,
  AgentStatusInfo,
  CanvasAgentServiceRef,
  PluginStore,
} from '../../../types';
import { SessionRouter } from '../core/sessions';

function memoryStore(): PluginStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(k: string) {
      return map.get(k) as T | undefined;
    },
    async set<T>(k: string, v: T) {
      map.set(k, v);
    },
    async delete(k: string) {
      map.delete(k);
    },
    async list() {
      return Array.from(map.keys());
    },
  };
}

/**
 * Fake agent service that models one "current session id" per workspace, with
 * an auto-incrementing id on newSession and a swap on loadSession — enough to
 * exercise the router's create/swap logic.
 */
function fakeService() {
  const current = new Map<string, string>();
  let counter = 0;
  const known = new Set<string>();

  const service: CanvasAgentServiceRef = {
    chat: async (): Promise<AgentChatResult> => ({ ok: true }),
    abort: () => {},
    answerClarification: () => true,
    getStatus: (): AgentStatusInfo => ({ ok: true, active: true, messageCount: 0 }),
    getCurrentSessionId: (ws) => current.get(ws) ?? null,
    newSession: async (ws) => {
      const id = `s${++counter}`;
      known.add(id);
      current.set(ws, id);
      return { ok: true };
    },
    loadSession: async (ws, sessionId) => {
      if (!known.has(sessionId)) return { ok: true }; // no-op when missing
      current.set(ws, sessionId);
      return { ok: true };
    },
    listSessions: async (): Promise<AgentSessionInfo[]> => [],
  };

  return { service, current };
}

describe('SessionRouter', () => {
  it('creates a session per conversation and swaps between them', async () => {
    const { service, current } = fakeService();
    const router = new SessionRouter(service, memoryStore());
    const W = 'ws1';

    await router.ensureSession(W, 'convA');
    const sa = current.get(W);
    expect(sa).toBeTruthy();

    // A different conversation gets its own fresh session.
    await router.ensureSession(W, 'convB');
    const sb = current.get(W);
    expect(sb).toBeTruthy();
    expect(sb).not.toBe(sa);

    // Returning to A swaps the current session back to A's, not a new one.
    await router.ensureSession(W, 'convA');
    expect(current.get(W)).toBe(sa);

    // And back to B.
    await router.ensureSession(W, 'convB');
    expect(current.get(W)).toBe(sb);
  });

  it('is a no-op when the conversation already owns the current session', async () => {
    const { service } = fakeService();
    const newSpy = vi.spyOn(service, 'newSession');
    const loadSpy = vi.spyOn(service, 'loadSession');
    const router = new SessionRouter(service, memoryStore());

    await router.ensureSession('ws1', 'convA'); // creates s1
    expect(newSpy).toHaveBeenCalledTimes(1);

    await router.ensureSession('ws1', 'convA'); // already current → no work
    expect(newSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('keys per workspace so the same conversation id is distinct across workspaces', async () => {
    const { service, current } = fakeService();
    const router = new SessionRouter(service, memoryStore());

    await router.ensureSession('wsX', 'conv');
    const sx = current.get('wsX');
    await router.ensureSession('wsY', 'conv');
    const sy = current.get('wsY');

    expect(sx).toBeTruthy();
    expect(sy).toBeTruthy();
    expect(sx).not.toBe(sy);
  });

  it('starts a fresh session when the mapped one no longer exists', async () => {
    const store = memoryStore();
    // Pre-seed a mapping pointing at a session id the service does not know.
    await store.set('sessions', { 'ws1::convA': 'ghost' });
    const { service, current } = fakeService();
    const router = new SessionRouter(service, store);

    await router.ensureSession('ws1', 'convA');
    // loadSession('ghost') is a no-op, so the router creates a real session.
    expect(current.get('ws1')).toBeTruthy();
    expect(current.get('ws1')).not.toBe('ghost');
  });
});
