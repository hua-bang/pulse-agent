import { describe, it, expect, vi } from 'vitest';
import type {
  AgentScope,
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
  const key = (scope: AgentScope) =>
    scope.kind === 'global' ? 'global' : `workspace:${scope.workspaceId}`;

  const service: CanvasAgentServiceRef = {
    chat: async (): Promise<AgentChatResult> => ({ ok: true }),
    chatWithScope: async (): Promise<AgentChatResult> => ({ ok: true }),
    abort: () => {},
    abortScope: () => {},
    answerClarification: () => true,
    answerClarificationForScope: () => true,
    getStatus: (): AgentStatusInfo => ({ ok: true, active: true, messageCount: 0 }),
    getStatusForScope: (): AgentStatusInfo => ({ ok: true, active: true, messageCount: 0 }),
    getCurrentSessionId: (ws) => current.get(ws) ?? null,
    getCurrentSessionIdForScope: (scope) => current.get(key(scope)) ?? null,
    newSession: async (ws) => {
      const id = `s${++counter}`;
      known.add(id);
      current.set(ws, id);
      return { ok: true };
    },
    newSessionForScope: async (scope) => {
      const id = `s${++counter}`;
      known.add(id);
      current.set(key(scope), id);
      return { ok: true };
    },
    loadSession: async (ws, sessionId) => {
      if (!known.has(sessionId)) return { ok: true }; // no-op when missing
      current.set(ws, sessionId);
      return { ok: true };
    },
    loadSessionForScope: async (scope, sessionId) => {
      if (!known.has(sessionId)) return { ok: true }; // no-op when missing
      current.set(key(scope), sessionId);
      return { ok: true };
    },
    listSessions: async (): Promise<AgentSessionInfo[]> => [],
    listSessionsForScope: async (): Promise<AgentSessionInfo[]> => [],
    copySessionToScope: async () => ({ ok: true }),
  };

  return { service, current };
}

describe('SessionRouter', () => {
  it('creates a session per conversation and swaps between them', async () => {
    const { service, current } = fakeService();
    const router = new SessionRouter(service, memoryStore());
    const scope: AgentScope = { kind: 'workspace', workspaceId: 'ws1' };
    const K = 'workspace:ws1';

    await router.ensureSession(scope, 'convA');
    const sa = current.get(K);
    expect(sa).toBeTruthy();

    // A different conversation gets its own fresh session.
    await router.ensureSession(scope, 'convB');
    const sb = current.get(K);
    expect(sb).toBeTruthy();
    expect(sb).not.toBe(sa);

    // Returning to A swaps the current session back to A's, not a new one.
    await router.ensureSession(scope, 'convA');
    expect(current.get(K)).toBe(sa);

    // And back to B.
    await router.ensureSession(scope, 'convB');
    expect(current.get(K)).toBe(sb);
  });

  it('is a no-op when the conversation already owns the current session', async () => {
    const { service } = fakeService();
    const newSpy = vi.spyOn(service, 'newSessionForScope');
    const loadSpy = vi.spyOn(service, 'loadSessionForScope');
    const router = new SessionRouter(service, memoryStore());

    await router.ensureSession({ kind: 'workspace', workspaceId: 'ws1' }, 'convA'); // creates s1
    expect(newSpy).toHaveBeenCalledTimes(1);

    await router.ensureSession({ kind: 'workspace', workspaceId: 'ws1' }, 'convA'); // already current → no work
    expect(newSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('keys per workspace so the same conversation id is distinct across workspaces', async () => {
    const { service, current } = fakeService();
    const router = new SessionRouter(service, memoryStore());

    await router.ensureSession({ kind: 'workspace', workspaceId: 'wsX' }, 'conv');
    const sx = current.get('workspace:wsX');
    await router.ensureSession({ kind: 'workspace', workspaceId: 'wsY' }, 'conv');
    const sy = current.get('workspace:wsY');

    expect(sx).toBeTruthy();
    expect(sy).toBeTruthy();
    expect(sx).not.toBe(sy);
  });

  it('starts a fresh session when the mapped one no longer exists', async () => {
    const store = memoryStore();
    // Pre-seed a mapping pointing at a session id the service does not know.
    await store.set('sessions', { 'workspace:ws1::convA': 'ghost' });
    const { service, current } = fakeService();
    const router = new SessionRouter(service, store);

    await router.ensureSession({ kind: 'workspace', workspaceId: 'ws1' }, 'convA');
    // loadSession('ghost') is a no-op, so the router creates a real session.
    expect(current.get('workspace:ws1')).toBeTruthy();
    expect(current.get('workspace:ws1')).not.toBe('ghost');
  });

  it('keeps global conversations in separate sessions', async () => {
    const { service, current } = fakeService();
    const router = new SessionRouter(service, memoryStore());
    const scope: AgentScope = { kind: 'global' };

    await router.ensureSession(scope, 'convA');
    const sa = current.get('global');
    await router.ensureSession(scope, 'convB');
    const sb = current.get('global');
    await router.ensureSession(scope, 'convA');

    expect(sa).toBeTruthy();
    expect(sb).toBeTruthy();
    expect(sb).not.toBe(sa);
    expect(current.get('global')).toBe(sa);
  });

  it('returns a mapped conversation session without activating the service', async () => {
    const { service } = fakeService();
    const router = new SessionRouter(service, memoryStore());
    const scope: AgentScope = { kind: 'global' };
    await router.setConversationSession(scope, 'convA', 's-existing');

    expect(await router.getConversationSessionId(scope, 'convA')).toBe('s-existing');
    expect(await router.getConversationSessionId(scope, 'convB')).toBeUndefined();
  });
});
