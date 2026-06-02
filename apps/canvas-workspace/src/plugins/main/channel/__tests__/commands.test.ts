import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  AgentChatResult,
  AgentSessionInfo,
  AgentStatusInfo,
  CanvasAgentServiceRef,
  PluginStore,
} from '../../../types';
import type { InboundMessage } from '../core/types';

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
    abort: () => {},
    answerClarification: () => true,
    getStatus: (): AgentStatusInfo => ({ ok: true, active: false, messageCount: 0 }),
    getCurrentSessionId: () => null,
    newSession: async () => ({ ok: true }),
    loadSession: async () => ({ ok: true }),
    listSessions: async (): Promise<AgentSessionInfo[]> => [],
    ...overrides,
  };
}

function msg(text: string): InboundMessage {
  return {
    channelId: 'feishu',
    conversationId: 'chatA',
    userId: 'u1',
    messageId: 'm1',
    text,
    isMention: false,
    isDirect: true,
    reply: null,
  };
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
    expect(out).toContain('ws-A');
    expect(await bindings.getBound('feishu', 'chatA')).toBe('ws-A');
  });

  it('/bind resolves a workspace by friendly name', async () => {
    const out = await handleCommand(msg('/bind Alpha'), makeDeps());
    expect(out).toContain('Alpha');
    expect(await bindings.getBound('feishu', 'chatA')).toBe('ws-A');
  });

  it('/bind rejects an unknown workspace', async () => {
    const out = await handleCommand(msg('/bind nope'), makeDeps());
    expect(out).toMatch(/not found/i);
    expect(await bindings.getBound('feishu', 'chatA')).toBeUndefined();
  });

  it('/default sets the suggested default', async () => {
    const out = await handleCommand(msg('/default ws-B'), makeDeps());
    expect(out).toContain('ws-B');
    expect(await bindings.getSuggestedDefault()).toBe('ws-B');
  });

  it('/bind with no argument binds the suggested default', async () => {
    await bindings.setDefault('ws-B');
    const out = await handleCommand(msg('/bind'), makeDeps());
    expect(await bindings.getBound('feishu', 'chatA')).toBe('ws-B');
    expect(out).toContain('Beta');
  });

  it('/new delegates to the service for the resolved workspace', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const newSession = vi.fn(async () => ({ ok: true }));
    const out = await handleCommand(msg('/new'), makeDeps(fakeService({ newSession })));
    expect(newSession).toHaveBeenCalledWith('ws-A');
    expect(out).toMatch(/new session/i);
  });

  it('/stop aborts the resolved workspace', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const abort = vi.fn();
    await handleCommand(msg('/stop'), makeDeps(fakeService({ abort })));
    expect(abort).toHaveBeenCalledWith('ws-A');
  });

  it('/list shows names and marks the bound workspace', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const out = await handleCommand(msg('/list'), makeDeps());
    expect(out).toContain('Alpha (ws-A)');
    expect(out).toContain('Beta (ws-B)');
    expect(out).toContain('⭐'); // bound workspace marker
  });

  it('/session switches to the chosen session by number', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const loadSession = vi.fn(async () => ({ ok: true }));
    const listSessions = vi.fn(async (): Promise<AgentSessionInfo[]> => [
      { sessionId: 's-current', date: '2026-06-01', messageCount: 4, isCurrent: true },
      { sessionId: 's-old', date: '2026-05-30', messageCount: 9, isCurrent: false },
    ]);
    const out = await handleCommand(
      msg('/session 2'),
      makeDeps(fakeService({ loadSession, listSessions })),
    );
    expect(loadSession).toHaveBeenCalledWith('ws-A', 's-old');
    expect(out).toMatch(/Switched to session/i);
  });

  it('/session rejects an out-of-range selector', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const listSessions = async (): Promise<AgentSessionInfo[]> => [
      { sessionId: 's1', date: '2026-06-01', messageCount: 1, isCurrent: true },
    ];
    const out = await handleCommand(msg('/session 9'), makeDeps(fakeService({ listSessions })));
    expect(out).toMatch(/not found/i);
  });

  it('/open activates the canvas for the bound workspace', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const activateCanvas = vi.fn(async () => ({ ok: true }));
    const out = await handleCommand(msg('/open'), { ...makeDeps(), activateCanvas });
    expect(activateCanvas).toHaveBeenCalledWith('ws-A');
    expect(out).toMatch(/activated/i);
  });

  it('/open reports when activation is unavailable', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const out = await handleCommand(msg('/open'), makeDeps());
    expect(out).toMatch(/not available/i);
  });

  it('/bind accepts a list number', async () => {
    const out = await handleCommand(msg('/bind 1'), makeDeps());
    expect(out).toContain('ws-A');
    expect(await bindings.getBound('feishu', 'chatA')).toBe('ws-A');
  });

  it('/ws on an unbound chat shows the workspace picker', async () => {
    const out = await handleCommand(msg('/ws'), makeDeps());
    expect(out).toMatch(/isn.t bound/i);
    expect(out).toContain('1. Alpha (ws-A)');
  });

  it('/new on an unbound chat asks the user to bind first', async () => {
    const newSession = vi.fn(async () => ({ ok: true }));
    const out = await handleCommand(msg('/new'), makeDeps(fakeService({ newSession })));
    expect(newSession).not.toHaveBeenCalled();
    expect(out).toMatch(/No workspace bound/i);
  });

  it('unknown command returns help text', async () => {
    const out = await handleCommand(msg('/wat'), makeDeps());
    expect(out).toMatch(/Unknown command/i);
  });
});
