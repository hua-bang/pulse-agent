import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentScope,
  AgentChatResult,
  AgentSessionInfo,
  AgentStatusInfo,
  CanvasAgentServiceRef,
  PluginStore,
} from '../../../types';
import type { ConversationRuntimeService } from '../../../../main/agent/conversation-runtime/conversation-service';
import type { CommandReply, InboundMessage } from '../core/types';

vi.mock('../core/workspaces', () => {
  const list = [
    { id: 'ws-A', name: 'Alpha', modifiedAt: 2, isActive: false },
    { id: 'ws-B', name: 'Beta', modifiedAt: 1, isActive: true },
  ];
  const label = (w: { id: string; name?: string }) => (w.name ? `${w.name} (${w.id})` : w.id);
  const resolve = (ref: string) => {
    if (/^#?\d{1,3}$/.test(ref.trim())) return list[Number(ref.replace('#', '')) - 1]?.id ?? null;
    return list.find(w => w.id === ref || w.name.toLowerCase() === ref.toLowerCase())?.id ?? null;
  };
  return {
    listWorkspaces: vi.fn(async () => list),
    resolveWorkspace: vi.fn(async (ref: string) => resolve(ref)),
    resolveWorkspaceRef: vi.fn(async (ref: string) => resolve(ref)),
    workspaceLabel: label,
    workspaceLabelById: vi.fn(async (id: string) => {
      const found = list.find(w => w.id === id);
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
    async get<T>(key: string) { return map.get(key) as T | undefined; },
    async set<T>(key: string, value: T) { map.set(key, value); },
    async delete(key: string) { map.delete(key); },
    async list() { return Array.from(map.keys()); },
  };
}

function fakeService(overrides: Partial<CanvasAgentServiceRef> = {}): CanvasAgentServiceRef {
  return {
    chat: async (): Promise<AgentChatResult> => ({ ok: true }),
    chatWithScope: async (): Promise<AgentChatResult> => ({ ok: true }),
    abort: () => {},
    abortScope: () => {},
    answerClarification: () => false,
    answerClarificationForScope: () => false,
    getStatus: (): AgentStatusInfo => ({ ok: true, active: false, messageCount: 0 }),
    getStatusForScope: (): AgentStatusInfo => ({ ok: true, active: false, messageCount: 0 }),
    getCurrentSessionId: () => 'ui-current',
    getCurrentSessionIdForScope: () => 'ui-current',
    newSession: async () => ({ ok: true }),
    newSessionForScope: async () => ({ ok: true }),
    loadSession: async () => ({ ok: true }),
    loadSessionForScope: async () => ({ ok: true }),
    listSessions: async (): Promise<AgentSessionInfo[]> => [],
    listSessionsForScope: async (): Promise<AgentSessionInfo[]> => [],
    copySessionToScope: async () => ({ ok: true, sessionId: 'legacy-copy', messageCount: 0 }),
    ...overrides,
  };
}

function fakeRuntime(overrides: Partial<{
  provisionSession: ConversationRuntimeService['provisionSession'];
  copySessionToScope: ConversationRuntimeService['copySessionToScope'];
  abort: ConversationRuntimeService['abort'];
}> = {}): ConversationRuntimeService {
  let counter = 0;
  return {
    provisionSession: vi.fn(async () => ({ ok: true, sessionId: `fresh-${++counter}` })),
    hasSession: vi.fn(async () => true),
    copySessionToScope: vi.fn(async () => ({
      ok: true,
      sessionId: `copied-${++counter}`,
      messageCount: 4,
    })),
    abort: vi.fn(() => true),
    ...overrides,
  } as unknown as ConversationRuntimeService;
}

function msg(text: string, overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channelId: 'feishu', conversationId: 'chatA', userId: 'u1', messageId: 'm1',
    text, isMention: false, isDirect: true, reply: null, ...overrides,
  };
}

function text(reply: CommandReply | null): string {
  expect(reply?.kind).toBe('text');
  return reply?.kind === 'text' ? reply.text : '';
}

function picker(reply: CommandReply | null) {
  expect(reply?.kind).toBe('workspace_picker');
  return reply?.kind === 'workspace_picker' ? reply.picker : null;
}

describe('handleCommand explicit conversation sessions', () => {
  let bindings: BindingStore;

  beforeEach(() => {
    bindings = new BindingStore(memoryStore());
  });

  const makeDeps = (
    service: CanvasAgentServiceRef = fakeService(),
    runtime: ConversationRuntimeService = fakeRuntime(),
  ) => ({
    bindings,
    service,
    runtime,
    sessionRouter: new SessionRouter(runtime, memoryStore()),
  });

  it('returns null for an ordinary message', async () => {
    expect(await handleCommand(msg('hello'), makeDeps())).toBeNull();
  });

  it('/new provisions a pointer-neutral session and never calls legacy pointer APIs', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const service = fakeService({
      newSessionForScope: vi.fn(async () => ({ ok: true })),
      getCurrentSessionIdForScope: vi.fn(() => 'ui-current'),
    });
    const runtime = fakeRuntime();
    const deps = makeDeps(service, runtime);

    const out = await handleCommand(msg('/new'), deps);

    expect(runtime.provisionSession).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'ws-A' });
    expect(service.newSessionForScope).not.toHaveBeenCalled();
    expect(service.getCurrentSessionIdForScope).not.toHaveBeenCalled();
    expect(await deps.sessionRouter.getConversationSessionId(
      { kind: 'workspace', workspaceId: 'ws-A' }, 'feishu', 'chatA',
    )).toBe('fresh-1');
    expect(text(out)).toMatch(/new session/i);
  });

  it('/use --fresh keeps the previous workspace when provisioning fails', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const runtime = fakeRuntime({ provisionSession: async () => ({ ok: false, error: 'disk full' }) });
    const out = await handleCommand(msg('/use ws-B --fresh'), makeDeps(fakeService(), runtime));
    expect(text(out)).toContain('disk full');
    expect(text(out)).not.toContain('✅');
    expect(await bindings.getBound('feishu', 'chatA')).toBe('ws-A');
  });

  it('/new reports provisioning failure without mapping the UI current session', async () => {
    const runtime = fakeRuntime({
      provisionSession: vi.fn(async () => ({ ok: false, error: 'disk failed' })),
    });
    const deps = makeDeps(fakeService(), runtime);

    const out = await handleCommand(msg('/new'), deps);

    expect(text(out)).toContain('disk failed');
    expect(await deps.sessionRouter.getConversationSessionId(
      { kind: 'global' }, 'feishu', 'chatA',
    )).toBeUndefined();
  });

  it('/stop aborts only this topic active session', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const runtime = fakeRuntime();
    const deps = { ...makeDeps(fakeService(), runtime), activeSessionId: 'active-topic-session' };

    await handleCommand(msg('/stop'), deps);

    expect(runtime.abort).toHaveBeenCalledWith(
      { kind: 'workspace', workspaceId: 'ws-A' },
      'active-topic-session',
    );
  });

  it('/session changes only the conversation mapping and never the UI pointer', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const loadSessionForScope = vi.fn(async () => ({ ok: true }));
    const service = fakeService({
      loadSessionForScope,
      listSessionsForScope: vi.fn(async () => [
        { sessionId: 's-current', date: '2026-06-01', messageCount: 4, isCurrent: true },
        { sessionId: 's-old', date: '2026-05-30', messageCount: 9, isCurrent: false },
      ]),
    });
    const deps = makeDeps(service);

    const out = await handleCommand(msg('/session 2'), deps);

    expect(loadSessionForScope).not.toHaveBeenCalled();
    expect(await deps.sessionRouter.getConversationSessionId(
      { kind: 'workspace', workspaceId: 'ws-A' }, 'feishu', 'chatA',
    )).toBe('s-old');
    expect(text(out)).toMatch(/Switched to session/i);
  });

  it('/bind carries the previous global topic through pointer-neutral runtime copy', async () => {
    const runtime = fakeRuntime();
    const deps = makeDeps(fakeService(), runtime);
    await deps.sessionRouter.setConversationSession(
      { kind: 'global' }, 'feishu', 'chatA', 'global-session',
    );

    const out = await handleCommand(msg('/bind Alpha'), deps);

    expect(runtime.copySessionToScope).toHaveBeenCalledWith(
      { kind: 'global' },
      'global-session',
      { kind: 'workspace', workspaceId: 'ws-A' },
    );
    expect(await bindings.getBound('feishu', 'chatA')).toBe('ws-A');
    expect(await deps.sessionRouter.getConversationSessionId(
      { kind: 'workspace', workspaceId: 'ws-A' }, 'feishu', 'chatA',
    )).toBe('copied-1');
    expect(text(out)).toContain('Migrated 4 previous messages');
  });

  it('/use --fresh provisions a new target session without carrying context', async () => {
    const runtime = fakeRuntime();
    const deps = makeDeps(fakeService(), runtime);
    await deps.sessionRouter.setConversationSession(
      { kind: 'global' }, 'feishu', 'chatA', 'global-session',
    );

    const out = await handleCommand(msg('/use Alpha --fresh'), deps);

    expect(runtime.copySessionToScope).not.toHaveBeenCalled();
    expect(runtime.provisionSession).toHaveBeenCalledWith(
      { kind: 'workspace', workspaceId: 'ws-A' },
    );
    expect(await deps.sessionRouter.getConversationSessionId(
      { kind: 'workspace', workspaceId: 'ws-A' }, 'feishu', 'chatA',
    )).toBe('fresh-1');
    expect(text(out)).toContain('Started a fresh session');
  });

  it('/use --carry copies direct-chat context explicitly', async () => {
    const runtime = fakeRuntime();
    const deps = makeDeps(fakeService(), runtime);
    await deps.sessionRouter.setConversationSession(
      { kind: 'global' }, 'feishu', 'chatA', 'global-session',
    );

    const out = await handleCommand(msg('/use Alpha --carry'), deps);

    expect(runtime.copySessionToScope).toHaveBeenCalled();
    expect(text(out)).toContain('Brought over 4 previous messages');
  });

  it('/list and /use without a target return the workspace picker', async () => {
    const deps = makeDeps();
    expect(picker(await handleCommand(msg('/list'), deps))?.options).toHaveLength(2);
    expect(picker(await handleCommand(msg('/use'), deps))?.options).toHaveLength(2);
  });

  it('/open activates a selected workspace without changing session routing', async () => {
    const activateCanvas = vi.fn(async () => ({ ok: true }));
    const deps = makeDeps();
    const out = await handleCommand(msg('/open Alpha'), { ...deps, activateCanvas });

    expect(activateCanvas).toHaveBeenCalledWith('ws-A');
    expect(await bindings.getBound('feishu', 'chatA')).toBeUndefined();
    expect(text(out)).toMatch(/activated/i);
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

  it('/session rejects an out-of-range selector', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const listSessionsForScope = async (): Promise<AgentSessionInfo[]> => [
      { sessionId: 's1', date: '2026-06-01', messageCount: 1, isCurrent: true },
    ];
    const out = await handleCommand(msg('/session 9'), makeDeps(fakeService({ listSessionsForScope })));
    expect(text(out)).toMatch(/not found/i);
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
    expect(text(out)).toMatch(/No workspace/i);
    expect(text(out)).toContain('2026-06-01');
  });

  it('unknown command returns help text', async () => {
    const out = await handleCommand(msg('/wat'), makeDeps());
    expect(text(out)).toMatch(/Unknown command/i);
  });
});
