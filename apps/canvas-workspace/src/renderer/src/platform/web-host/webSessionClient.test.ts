import { describe, expect, it, vi } from 'vitest';
import type { PulseStorage } from '@pulse-coder/storage';
import { createWebSessionClient } from './webSessionClient';

function makeMockStorage() {
  const scopes = new Map<string, { revision: number; currentSessionId: string | null }>([
    ['ws-1', { revision: 2, currentSessionId: 'vps-new' }],
    ['ws-2', { revision: 1, currentSessionId: 'vps-other' }],
  ]);
  const conversations = new Map<
    string,
    Array<{ sessionId: string; metadata: Record<string, unknown>; messages: unknown[] }>
  >([
    [
      'ws-1',
      [
        {
          sessionId: 'vps-old',
          metadata: { title: 'Earlier chat', updatedAt: 1000, messageCount: 4, preview: 'hi' },
          messages: [
            { role: 'user', content: 'hello', timestamp: 900 },
            { role: 'assistant', content: 'hi', timestamp: 1000 },
          ],
        },
        {
          sessionId: 'vps-new',
          metadata: { title: 'New chat', updatedAt: 2000, messageCount: 2, preview: 'hey' },
          messages: [
            { role: 'user', content: 'new', timestamp: 1900 },
            { role: 'assistant', content: 'hey', timestamp: 2000 },
          ],
        },
        {
          sessionId: 'vps-empty',
          metadata: { title: 'Empty', updatedAt: 3000, messageCount: 0 },
          messages: [],
        },
      ],
    ],
    [
      'ws-2',
      [
        {
          sessionId: 'vps-other',
          metadata: { title: 'Other ws', updatedAt: 1500, messageCount: 2, preview: 'yo' },
          messages: [],
        },
      ],
    ],
  ]);

  const commitScope = vi.fn(async (input: { scopeId: string; currentSessionId?: string | null }) => {
    const prev = scopes.get(input.scopeId);
    scopes.set(input.scopeId, {
      revision: (prev?.revision ?? 0) + 1,
      currentSessionId: input.currentSessionId ?? null,
    });
    return { revision: (prev?.revision ?? 0) + 1 };
  });

  const storage = {
    conversationScopes: {
      read: vi.fn(async (scopeId: string) => scopes.get(scopeId) ?? null),
      commit: commitScope,
    },
    conversations: {
      list: vi.fn(async (scopeId: string) => ({
        items: (conversations.get(scopeId) ?? []).map(({ sessionId, metadata }) => ({ sessionId, metadata })),
        nextCursor: undefined,
      })),
      read: vi.fn(async (scopeId: string, sessionId: string) => {
        const list = conversations.get(scopeId) ?? [];
        return list.find((item) => item.sessionId === sessionId) ?? null;
      }),
    },
  } as unknown as PulseStorage;

  return { storage, commitScope };
}

describe('createWebSessionClient', () => {
  it('lists previous and current sessions across workspaces via listAllSessions', async () => {
    const { storage } = makeMockStorage();
    const client = createWebSessionClient(
      { endpoint: 'https://vps.example', token: 'tok', role: 'admin', clientId: 'c1', senderName: 'Alice' },
      async () => storage,
      () => 'ws-1',
    );

    const result = await client.listAllSessions({ 'ws-1': 'Main WS', 'ws-2': 'Second WS' });
    expect(result.ok).toBe(true);
    const ws1 = result.groups?.find((g) => g.workspaceId === 'ws-1');
    expect(ws1?.workspaceName).toBe('Main WS');
    expect(ws1?.sessions.map((s) => s.sessionId)).toEqual(['vps-new', 'vps-old']);
    expect(ws1?.sessions.find((s) => s.sessionId === 'vps-new')?.isCurrent).toBe(true);
    expect(ws1?.sessions.find((s) => s.sessionId === 'vps-old')?.isCurrent).toBe(false);
    expect(result.groups?.find((g) => g.workspaceId === 'ws-2')?.sessions.map((s) => s.sessionId)).toEqual([
      'vps-other',
    ]);
  });

  it('restricts listAllSessions to the shared workspace when using a share token', async () => {
    const { storage } = makeMockStorage();
    const client = createWebSessionClient(
      {
        endpoint: 'https://vps.example',
        token: 'tok',
        role: 'collaborator',
        workspaceId: 'ws-1',
        clientId: 'c1',
        senderName: 'Bob',
      },
      async () => storage,
      () => 'ws-1',
    );

    const result = await client.listAllSessions({ 'ws-1': 'Main WS', 'ws-2': 'Second WS' });
    expect(result.ok).toBe(true);
    expect(result.groups?.map((g) => g.workspaceId)).toEqual(['ws-1']);
  });

  it('loads a previous session and updates currentSessionId', async () => {
    const { storage, commitScope } = makeMockStorage();
    const client = createWebSessionClient(
      { endpoint: 'https://vps.example', token: 'tok', role: 'admin', clientId: 'c1', senderName: 'Alice' },
      async () => storage,
      () => 'ws-1',
    );

    const loaded = await client.loadSession({ scope: { kind: 'workspace', workspaceId: 'ws-1' } }, 'vps-old');
    expect(loaded.ok).toBe(true);
    expect(loaded.activeSessionId).toBe('vps-old');
    expect(loaded.messages?.length).toBe(2);
    expect(commitScope).toHaveBeenCalledWith(
      expect.objectContaining({ scopeId: 'ws-1', currentSessionId: 'vps-old' }),
    );
  });
});
