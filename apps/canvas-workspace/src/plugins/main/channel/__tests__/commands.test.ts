import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  AgentScope,
  AgentChatResult,
  AgentSessionInfo,
  AgentStatusInfo,
  CanvasAgentServiceRef,
  PluginStore,
} from '../../../types';
import type { CommandReply, InboundMessage } from '../core/types';

// Mock the disk-backed workspace helpers so command tests stay hermetic.
vi.mock('../core/workspaces', () => {
  const list = [
    { id: 'ws-A', name: 'Alpha', modifiedAt: 2, isActive: false },
    { id: 'ws-B', name: 'Beta', modifiedAt: 1, isActive: true },
  ];
  const label = (w: { id: string; name?: string }) => (w.name ? `${w.name} (${w.id})` : w.id);
  const resolve = (ref: string) => {
    const byId = list.find((w) => w.id === ref);
    if (byId) return byId.id;
    const byName = list.find((w) => w.name.toLowerCase() === ref.toLowerCase());
    return byName?.id ?? null;
  };
  return {
    listWorkspaces: vi.fn(async () => list),
    resolveWorkspace: vi.fn(async (ref: string) => resolve(ref)),
    resolveWorkspaceRef: vi.fn(async (ref: string) => {
      if (/^#?\d{1,3}$/.test(ref.trim())) {
        const n = Number(ref.trim().replace('#', ''));
        if (n >= 1 && n <= list.length) return list[n - 1].id;
      }
      return resolve(ref);
    }),
    workspaceLabel: label,
    workspaceLabelById: vi.fn(async (id: string) => {
      const found = list.find((w) => w.id === id);
      return found ? label(found) : id;
    }),
  };
});

import { handleCommand } from '../core/commands';
import { BindingStore } from '../core/binding';
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

function fakeService(overrides: Partial<CanvasAgentServiceRef> = {}): CanvasAgentServiceRef {
  return {
    chat: async (): Promise<AgentChatResult> => ({ ok: true, response: 'hi' }),
    chatWithScope: async (): Promise<AgentChatResult> => ({ ok: true, response: 'hi' }),
    abort: () => {},
    abortScope: () => {},
    answerClarification: () => true,
    answerClarificationForScope: () => true,
    getStatus: (): AgentStatusInfo => ({ ok: true, active: false, messageCount: 0 }),
    getStatusForScope: (): AgentStatusInfo => ({ ok: true, active: false, messageCount: 0 }),
    getCurrentSessionId: () => null,
    getCurrentSessionIdForScope: () => null,
    newSession: async () => ({ ok: true }),
    newSessionForScope: async () => ({ ok: true }),
    loadSession: async () => ({ ok: true }),
    loadSessionForScope: async () => ({ ok: true }),
    listSessions: async (): Promise<AgentSessionInfo[]> => [],
    listSessionsForScope: async (): Promise<AgentSessionInfo[]> => [],
    copySessionToScope: async () => ({ ok: true, sessionId: 'copied-session', messageCount: 0 }),
    ...overrides,
  };
}

function msg(text: string, overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channelId: 'feishu',
    conversationId: 'chatA',
    userId: 'u1',
    messageId: 'm1',
    text,
    isMention: false,
    isDirect: true,
    reply: null,
    ...overrides,
  };
}

function text(out: CommandReply | null): string {
  expect(out?.kind).toBe('text');
  return out && out.kind === 'text' ? out.text : '';
}

function picker(out: CommandReply | null) {
  expect(out?.kind).toBe('workspace_picker');
  return out && out.kind === 'workspace_picker' ? out.picker : null;
}

describe('handleCommand', () => {
  let bindings: BindingStore;
  beforeEach(() => {
    bindings = new BindingStore(memoryStore());
  });

  const makeDeps = (service: CanvasAgentServiceRef = fakeService()) => ({
    bindings,
    service,
    sessionRouter: new SessionRouter(service, memoryStore()),
  });

  it('returns null for ordinary (non-slash) messages', async () => {
    const out = await handleCommand(msg('hello there'), makeDeps());
    expect(out).toBeNull();
  });

  it('/bind binds the chat to an existing workspace by id', async () => {
    const out = await handleCommand(msg('/bind ws-A'), makeDeps());
    expect(text(out)).toContain('ws-A');
    expect(await bindings.getBound('feishu', 'chatA')).toBe('ws-A');
  });

  it('/bind resolves a workspace by friendly name', async () => {
    const out = await handleCommand(msg('/bind Alpha'), makeDeps());
    expect(text(out)).toContain('Alpha');
    expect(await bindings.getBound('feishu', 'chatA')).toBe('ws-A');
  });

  it('/bind migrates the previous global conversation session into the workspace scope', async () => {
    const service = fakeService({
      copySessionToScope: vi.fn(async () => ({
        ok: true,
        sessionId: 'workspace-session',
        messageCount: 4,
      })),
    });
    const deps = makeDeps(service);
    await deps.sessionRouter.setConversationSession({ kind: 'global' }, 'chatA', 'global-session');

    const out = await handleCommand(msg('/bind Alpha'), deps);

    expect(service.copySessionToScope).toHaveBeenCalledWith(
      { kind: 'global' },
      'global-session',
      { kind: 'workspace', workspaceId: 'ws-A' },
    );
    expect(
      await deps.sessionRouter.getConversationSessionId(
        { kind: 'workspace', workspaceId: 'ws-A' },
        'chatA',
      ),
    ).toBe('workspace-session');
    expect(text(out)).toContain('Migrated 4 previous messages');
  });

  it('/bind rejects an unknown workspace', async () => {
    const out = await handleCommand(msg('/bind nope'), makeDeps());
    expect(text(out)).toMatch(/not found/i);
    expect(await bindings.getBound('feishu', 'chatA')).toBeUndefined();
  });

  it('/default sets the suggested default', async () => {
    const out = await handleCommand(msg('/default ws-B'), makeDeps());
    expect(text(out)).toContain('ws-B');
    expect(await bindings.getSuggestedDefault()).toBe('ws-B');
  });

  it('/bind with no argument binds the suggested default', async () => {
    await bindings.setDefault('ws-B');
    const out = await handleCommand(msg('/bind'), makeDeps());
    expect(await bindings.getBound('feishu', 'chatA')).toBe('ws-B');
    expect(text(out)).toContain('Beta');
  });

  it('/new delegates to the service for the resolved workspace', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const newSessionForScope = vi.fn(async () => ({ ok: true }));
    const out = await handleCommand(msg('/new'), makeDeps(fakeService({ newSessionForScope })));
    expect(newSessionForScope).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'ws-A' });
    expect(text(out)).toMatch(/new session/i);
  });

  it('/new on an unbound chat starts a global session', async () => {
    const newSessionForScope = vi.fn(async () => ({ ok: true }));
    const getCurrentSessionIdForScope = vi.fn(() => 'fresh-global');
    const deps = makeDeps(fakeService({ newSessionForScope, getCurrentSessionIdForScope }));
    const out = await handleCommand(msg('/new'), deps);
    expect(newSessionForScope).toHaveBeenCalledWith({ kind: 'global' });
    expect(await deps.sessionRouter.getConversationSessionId({ kind: 'global' }, 'chatA')).toBe('fresh-global');
    expect(text(out)).toMatch(/Global chat/i);
  });

  it('/stop aborts the resolved workspace', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const abortScope = vi.fn();
    await handleCommand(msg('/stop'), makeDeps(fakeService({ abortScope })));
    expect(abortScope).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'ws-A' });
  });

  it('/stop on an unbound chat aborts global scope', async () => {
    const abortScope = vi.fn();
    await handleCommand(msg('/stop'), makeDeps(fakeService({ abortScope })));
    expect(abortScope).toHaveBeenCalledWith({ kind: 'global' });
  });

  it('/list shows names and marks the bound workspace', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const out = await handleCommand(msg('/list'), makeDeps());
    const p = picker(out);
    expect(p?.fallbackText).toContain('Alpha (ws-A)');
    expect(p?.fallbackText).toContain('Beta (ws-B)');
    expect(p?.fallbackText).toContain('⭐'); // bound workspace marker
  });

  it('/use with no argument shows the same workspace picker as /list', async () => {
    const list = await handleCommand(msg('/list'), makeDeps());
    const use = await handleCommand(msg('/use'), makeDeps());
    expect(picker(use)).toEqual(picker(list));
  });

  it('/session switches to the chosen session by number', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const loadSessionForScope = vi.fn(async () => ({ ok: true }));
    const listSessionsForScope = vi.fn(async (): Promise<AgentSessionInfo[]> => [
      { sessionId: 's-current', date: '2026-06-01', messageCount: 4, isCurrent: true },
      { sessionId: 's-old', date: '2026-05-30', messageCount: 9, isCurrent: false },
    ]);
    const out = await handleCommand(
      msg('/session 2'),
      makeDeps(fakeService({ loadSessionForScope, listSessionsForScope })),
    );
    expect(loadSessionForScope).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'ws-A' }, 's-old');
    expect(text(out)).toMatch(/Switched to session/i);
  });

  it('/session rejects an out-of-range selector', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const listSessionsForScope = async (): Promise<AgentSessionInfo[]> => [
      { sessionId: 's1', date: '2026-06-01', messageCount: 1, isCurrent: true },
    ];
    const out = await handleCommand(msg('/session 9'), makeDeps(fakeService({ listSessionsForScope })));
    expect(text(out)).toMatch(/not found/i);
  });

  it('/open activates the canvas for the bound workspace', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const activateCanvas = vi.fn(async () => ({ ok: true }));
    const out = await handleCommand(msg('/open'), { ...makeDeps(), activateCanvas });
    expect(activateCanvas).toHaveBeenCalledWith('ws-A');
    expect(text(out)).toMatch(/activated/i);
  });

  it('/open reports when activation is unavailable', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const out = await handleCommand(msg('/open'), makeDeps());
    expect(text(out)).toMatch(/not available/i);
  });

  it('/open can activate a workspace by name without binding the chat', async () => {
    const activateCanvas = vi.fn(async () => ({ ok: true }));
    const out = await handleCommand(msg('/open Alpha'), { ...makeDeps(), activateCanvas });
    expect(activateCanvas).toHaveBeenCalledWith('ws-A');
    expect(await bindings.getBound('feishu', 'chatA')).toBeUndefined();
    expect(text(out)).toMatch(/activated/i);
  });

  it('/open can activate a workspace by list number without binding the chat', async () => {
    const activateCanvas = vi.fn(async () => ({ ok: true }));
    const out = await handleCommand(msg('/open 2'), { ...makeDeps(), activateCanvas });
    expect(activateCanvas).toHaveBeenCalledWith('ws-B');
    expect(await bindings.getBound('feishu', 'chatA')).toBeUndefined();
    expect(text(out)).toMatch(/activated/i);
  });

  it('/open without a target asks for a workspace when unbound', async () => {
    const activateCanvas = vi.fn(async () => ({ ok: true }));
    const out = await handleCommand(msg('/open'), { ...makeDeps(), activateCanvas });
    expect(activateCanvas).not.toHaveBeenCalled();
    expect(text(out)).toMatch(/Usage: \/open/i);
  });

  it('/use binds and opens a workspace by name', async () => {
    const activateCanvas = vi.fn(async () => ({ ok: true }));
    const out = await handleCommand(msg('/use Alpha'), { ...makeDeps(), activateCanvas });
    expect(await bindings.getBound('feishu', 'chatA')).toBe('ws-A');
    expect(activateCanvas).toHaveBeenCalledWith('ws-A');
    expect(text(out)).toMatch(/Using Alpha \(ws-A\)/);
    expect(text(out)).toMatch(/Opened in Canvas/i);
  });

  it('/use accepts a list number', async () => {
    const activateCanvas = vi.fn(async () => ({ ok: true }));
    const out = await handleCommand(msg('/use 2'), { ...makeDeps(), activateCanvas });
    expect(await bindings.getBound('feishu', 'chatA')).toBe('ws-B');
    expect(activateCanvas).toHaveBeenCalledWith('ws-B');
    expect(text(out)).toMatch(/Beta \(ws-B\)/);
  });

  it('/use in a direct chat does not carry previous global context by default', async () => {
    const service = fakeService({
      copySessionToScope: vi.fn(async () => ({
        ok: true,
        sessionId: 'workspace-session',
        messageCount: 7,
      })),
    });
    const deps = makeDeps(service);
    const activateCanvas = vi.fn(async () => ({ ok: true }));
    await deps.sessionRouter.setConversationSession({ kind: 'global' }, 'chatA', 'global-session');

    const out = await handleCommand(msg('/use Alpha'), { ...deps, activateCanvas });

    expect(service.copySessionToScope).not.toHaveBeenCalled();
    expect(text(out)).not.toContain('Brought over');
    expect(activateCanvas).toHaveBeenCalledWith('ws-A');
  });

  it('/use in a new group carries previous global context by default', async () => {
    const service = fakeService({
      copySessionToScope: vi.fn(async () => ({
        ok: true,
        sessionId: 'workspace-session',
        messageCount: 7,
      })),
    });
    const deps = makeDeps(service);
    const activateCanvas = vi.fn(async () => ({ ok: true }));
    await deps.sessionRouter.setConversationSession({ kind: 'global' }, 'chatA', 'global-session');

    const out = await handleCommand(
      msg('/use Alpha', { isDirect: false, isMention: true }),
      { ...deps, activateCanvas },
    );

    expect(service.copySessionToScope).toHaveBeenCalledWith(
      { kind: 'global' },
      'global-session',
      { kind: 'workspace', workspaceId: 'ws-A' },
    );
    expect(
      await deps.sessionRouter.getConversationSessionId(
        { kind: 'workspace', workspaceId: 'ws-A' },
        'chatA',
      ),
    ).toBe('workspace-session');
    expect(text(out)).toContain('Brought over 7 previous messages');
  });

  it('/use --carry carries previous direct chat context explicitly', async () => {
    const service = fakeService({
      copySessionToScope: vi.fn(async () => ({
        ok: true,
        sessionId: 'workspace-session',
        messageCount: 7,
      })),
    });
    const deps = makeDeps(service);
    const activateCanvas = vi.fn(async () => ({ ok: true }));
    await deps.sessionRouter.setConversationSession({ kind: 'global' }, 'chatA', 'global-session');

    const out = await handleCommand(msg('/use Alpha --carry'), { ...deps, activateCanvas });

    expect(service.copySessionToScope).toHaveBeenCalled();
    expect(text(out)).toContain('Brought over 7 previous messages');
  });

  it('/use --fresh starts a fresh session instead of carrying context', async () => {
    const service = fakeService({
      copySessionToScope: vi.fn(async () => ({
        ok: true,
        sessionId: 'workspace-session',
        messageCount: 7,
      })),
      newSessionForScope: vi.fn(async () => ({ ok: true })),
      getCurrentSessionIdForScope: vi.fn(() => 'fresh-session'),
    });
    const deps = makeDeps(service);
    const activateCanvas = vi.fn(async () => ({ ok: true }));
    await deps.sessionRouter.setConversationSession({ kind: 'global' }, 'chatA', 'global-session');

    const out = await handleCommand(
      msg('/use Alpha --fresh', { isDirect: false, isMention: true }),
      { ...deps, activateCanvas },
    );

    expect(service.copySessionToScope).not.toHaveBeenCalled();
    expect(service.newSessionForScope).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'ws-A' });
    expect(
      await deps.sessionRouter.getConversationSessionId(
        { kind: 'workspace', workspaceId: 'ws-A' },
        'chatA',
      ),
    ).toBe('fresh-session');
    expect(text(out)).toContain('Started a fresh session');
  });

  it('/bind accepts a list number', async () => {
    const out = await handleCommand(msg('/bind 1'), makeDeps());
    expect(text(out)).toContain('ws-A');
    expect(await bindings.getBound('feishu', 'chatA')).toBe('ws-A');
  });

  it('/ws on an unbound chat shows the workspace picker', async () => {
    const out = await handleCommand(msg('/ws'), makeDeps());
    expect(text(out)).toMatch(/not connected/i);
    expect(text(out)).toMatch(/\/use/i);
  });

  it('/sessions on an unbound chat lists global sessions', async () => {
    const listSessionsForScope = vi.fn(async (_scope: AgentScope): Promise<AgentSessionInfo[]> => [
      { sessionId: 'global-s1', date: '2026-06-01', messageCount: 3, isCurrent: true },
    ]);
    const out = await handleCommand(msg('/sessions'), makeDeps(fakeService({ listSessionsForScope })));
    expect(listSessionsForScope).toHaveBeenCalledWith({ kind: 'global' });
    expect(text(out)).toMatch(/Global chat/i);
    expect(text(out)).toContain('2026-06-01');
  });

  it('unknown command returns help text', async () => {
    const out = await handleCommand(msg('/wat'), makeDeps());
    expect(text(out)).toMatch(/Unknown command/i);
  });
});
