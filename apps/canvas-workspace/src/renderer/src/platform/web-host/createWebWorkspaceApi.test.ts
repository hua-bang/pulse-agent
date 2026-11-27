// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseInviteInput } from './authGate';
import { createWebWorkspaceApi } from './createWebWorkspaceApi';
import type { WebHostAuthSession } from './types';

function createSession(overrides: Partial<WebHostAuthSession> = {}): WebHostAuthSession {
  return {
    endpoint: 'https://vps.example.test',
    token: 'tok-test',
    role: 'admin',
    senderName: 'Jasper',
    clientId: 'web-client-1',
    version: '0.2.0',
    ...overrides,
  };
}

describe('createWebWorkspaceApi', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('builds workspace manifest from scoped share token and enforces viewer read-only save', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { items: [], nextCursor: undefined } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = createWebWorkspaceApi(
      createSession({ role: 'viewer', workspaceId: 'ws-shared', shareLabel: 'Shared Canvas' }),
    );

    expect(api.version).toBe('0.2.0');

    const manifest = await api.store.load('__workspaces__');
    expect(manifest.ok).toBe(true);
    expect(manifest.data).toMatchObject({
      activeId: 'ws-shared',
      workspaces: [{ id: 'ws-shared', name: 'Shared Canvas' }],
    });

    const saveResult = await api.store.save('ws-shared', { nodes: [], edges: [], revision: 7 });
    expect(saveResult.ok).toBe(true);
    expect(saveResult.revision).toBe(7);
    expect(fetchMock).not.toHaveBeenCalled();

    const writeFile = await api.file.write('notes/a.md', 'hello');
    expect(writeFile.ok).toBe(false);
  });

  it('forwards remoteVps presence and chat-room calls with Bearer auth', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer tok-test');
      if (url.includes('/v1/presence')) {
        return new Response(
          JSON.stringify({
            ok: true,
            peers: [
              { clientId: 'web-client-1', name: 'Jasper', role: 'admin', updatedAt: 100 },
              { clientId: 'mac-2', name: 'Alex', role: 'collaborator', updatedAt: 100 },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/v1/chat-room/enqueue')) {
        return new Response(
          JSON.stringify({
            ok: true,
            claimed: false,
            queuedItem: { id: 'q1', clientId: 'web-client-1', senderName: 'Jasper', message: 'hi', createdAt: 1 },
            snapshot: { activeTurn: null, queue: [] },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = createWebWorkspaceApi(createSession());

    const cfg = await api.remoteVps.getConfig('ws-1');
    expect(cfg.ok).toBe(true);
    expect(cfg.config?.kind).toBe('vps');
    expect(cfg.config?.remoteWorkspaceId).toBe('ws-1');

    const presence = await api.remoteVps.getPresence?.('ws-1');
    expect(presence?.ok).toBe(true);
    expect(presence?.peers.find((p) => p.clientId === 'web-client-1')?.self).toBe(true);
    expect(presence?.peers.find((p) => p.clientId === 'mac-2')?.self).toBe(false);

    const enqueued = await api.remoteVps.enqueueChatRoom?.('ws-1', 'conv-1', 'hi');
    expect(enqueued?.ok).toBe(true);
    expect(enqueued?.queuedItem?.self).toBe(true);
  });

  it('guards shell.openExternal to http/https URLs only', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const api = createWebWorkspaceApi(createSession());

    const blocked = await api.shell.openExternal('javascript:alert(1)');
    expect(blocked.ok).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();

    const allowed = await api.shell.openExternal('https://example.com');
    expect(allowed.ok).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
  });

  it('decodes native pulse-share://v1/<base64url> invite codes and ?invite= URLs', () => {
    const payload = {
      v: 1,
      endpoint: 'https://my-vps.ts.net',
      workspaceId: 'ws-demo',
      token: 'sh_secret_123',
      role: 'collaborator',
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const fromChat = parseInviteInput(`快加入我的画布：pulse-share://v1/${encoded} 试试看`);
    expect(fromChat).toEqual({ endpoint: 'https://my-vps.ts.net', token: 'sh_secret_123' });

    const fromWebUrl = parseInviteInput(`https://pulse-canvas-web.pages.dev/?invite=${encoded}`);
    expect(fromWebUrl).toEqual({ endpoint: 'https://my-vps.ts.net', token: 'sh_secret_123' });

    const fromDeepLink = parseInviteInput(`点此加入：pulse-canvas://join?code=${encoded}`);
    expect(fromDeepLink).toEqual({ endpoint: 'https://my-vps.ts.net', token: 'sh_secret_123' });
  });

  it('normalizes desktop absolute file paths to pulse-remote:/// URIs and blocks out-of-scope paths', async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      requestedUrls.push(url);
      return new Response(
        JSON.stringify({
          ok: true,
          uri: 'pulse-remote:///ws-1/notes/DAG.md',
          version: 'sha256:abc',
          base64: Buffer.from('# Hello', 'utf8').toString('base64'),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = createWebWorkspaceApi(createSession({ workspaceId: 'ws-1' }));
    const res = await api.file.read('/Users/bytedance/.pulse/workspaces/ws-1/notes/DAG.md');
    expect(res.ok).toBe(true);
    expect(res.content).toBe('# Hello');
    expect(requestedUrls[0]).toContain(encodeURIComponent('pulse-remote:///ws-1/notes/DAG.md'));

    const outside = await api.file.read('/Users/bytedance/Desktop/secret.txt');
    expect(outside.ok).toBe(false);
    expect(requestedUrls).toHaveLength(1);
  });

  it('unwraps nested AgentScopeRef { scope: { kind: workspace, workspaceId } } for conversation RPCs', async () => {
    const rpcCalls: Array<{ method: string; args: unknown[] }> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) {
        const parsed = JSON.parse(String(init.body)) as { method: string; args: unknown[] };
        rpcCalls.push(parsed);
        if (parsed.method === 'conversationScopes.read') {
          return new Response(JSON.stringify({ ok: true, result: { currentSessionId: 'sess-1' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (parsed.method === 'conversations.read') {
          return new Response(JSON.stringify({ ok: true, result: { messages: [] } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      return new Response(JSON.stringify({ ok: true, result: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = createWebWorkspaceApi(createSession({ workspaceId: 'ws-1' }));
    const history = await api.agent.getHistory({ scope: { kind: 'workspace', workspaceId: 'ws-1' } });
    expect(history.ok).toBe(true);
    expect(rpcCalls[0]).toEqual({ method: 'conversationScopes.read', args: ['ws-1'] });
    expect(rpcCalls[1]).toEqual({ method: 'conversations.read', args: ['ws-1', 'sess-1'] });
  });
});
