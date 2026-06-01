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
  return {
    listWorkspaces: vi.fn(async () => list),
    resolveWorkspace: vi.fn(async (ref: string) => {
      const byId = list.find((w) => w.id === ref);
      if (byId) return byId.id;
      const byName = list.find((w) => w.name.toLowerCase() === ref.toLowerCase());
      return byName?.id ?? null;
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

  it('returns null for ordinary (non-slash) messages', async () => {
    const out = await handleCommand(msg('hello there'), { bindings, service: fakeService() });
    expect(out).toBeNull();
  });

  it('/bind binds the chat to an existing workspace by id', async () => {
    const out = await handleCommand(msg('/bind ws-A'), { bindings, service: fakeService() });
    expect(out).toContain('ws-A');
    expect(await bindings.getExplicit('feishu', 'chatA')).toBe('ws-A');
  });

  it('/bind resolves a workspace by friendly name', async () => {
    const out = await handleCommand(msg('/bind Alpha'), { bindings, service: fakeService() });
    expect(out).toContain('Alpha');
    expect(await bindings.getExplicit('feishu', 'chatA')).toBe('ws-A');
  });

  it('/bind rejects an unknown workspace', async () => {
    const out = await handleCommand(msg('/bind nope'), { bindings, service: fakeService() });
    expect(out).toMatch(/not found/i);
    expect(await bindings.getExplicit('feishu', 'chatA')).toBeUndefined();
  });

  it('/default sets the global default', async () => {
    const out = await handleCommand(msg('/default ws-B'), { bindings, service: fakeService() });
    expect(out).toContain('ws-B');
    expect(await bindings.getDefault()).toBe('ws-B');
  });

  it('/new delegates to the service for the resolved workspace', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const newSession = vi.fn(async () => ({ ok: true }));
    const out = await handleCommand(msg('/new'), { bindings, service: fakeService({ newSession }) });
    expect(newSession).toHaveBeenCalledWith('ws-A');
    expect(out).toMatch(/new session/i);
  });

  it('/stop aborts the resolved workspace', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const abort = vi.fn();
    await handleCommand(msg('/stop'), { bindings, service: fakeService({ abort }) });
    expect(abort).toHaveBeenCalledWith('ws-A');
  });

  it('/list shows names and marks the bound workspace', async () => {
    await bindings.bind('feishu', 'chatA', 'ws-A');
    const out = await handleCommand(msg('/list'), { bindings, service: fakeService() });
    expect(out).toContain('Alpha (ws-A)');
    expect(out).toContain('Beta (ws-B)');
    expect(out).toContain('⭐'); // bound workspace marker
  });

  it('unknown command returns help text', async () => {
    const out = await handleCommand(msg('/wat'), { bindings, service: fakeService() });
    expect(out).toMatch(/Unknown command/i);
  });
});
