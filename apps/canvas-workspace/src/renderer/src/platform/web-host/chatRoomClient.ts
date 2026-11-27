import type {
  RemoteVpsApi,
  RemoteVpsChatRoomActiveTurn,
  RemoteVpsChatRoomEvent,
  RemoteVpsChatRoomQueuedItem,
  RemoteVpsPresencePeer,
  RemoteVpsShareRole,
  RemoteVpsWorkspaceConfigDto,
} from '../../../../shared/api/remote-vps';
import type { WebHostAuthSession } from './types';

function markSelfTurn(
  turn: RemoteVpsChatRoomActiveTurn | null | undefined,
  selfId: string,
): RemoteVpsChatRoomActiveTurn | null {
  return turn ? { ...turn, self: turn.clientId === selfId } : null;
}

function markSelfQueue(
  queue: RemoteVpsChatRoomQueuedItem[] | undefined,
  selfId: string,
): RemoteVpsChatRoomQueuedItem[] {
  return Array.isArray(queue)
    ? queue.map((item) => ({ ...item, self: item.clientId === selfId }))
    : [];
}

function markSelfPeers(peers: RemoteVpsPresencePeer[] | undefined, selfId: string): RemoteVpsPresencePeer[] {
  return Array.isArray(peers) ? peers.map((peer) => ({ ...peer, self: peer.clientId === selfId })) : [];
}

export function createWebRemoteVpsApi(session: WebHostAuthSession): RemoteVpsApi {
  const { endpoint, token, clientId, senderName, role } = session;
  const authHeader = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { ...authHeader, 'Content-Type': 'application/json' };

  const listeners = new Set<(event: RemoteVpsChatRoomEvent) => void>();
  const activeStreams = new Map<string, { refCount: number; abort: AbortController }>();

  const emit = (event: RemoteVpsChatRoomEvent) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Isolate subscriber errors.
      }
    }
  };

  async function postChatRoom(
    workspaceId: string,
    path: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`${endpoint}/v1/chat-room/${path}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        workspaceId,
        clientId,
        senderName,
        ...payload,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  }

  async function runChatRoomSse(workspaceId: string, abort: AbortController): Promise<void> {
    while (!abort.signal.aborted) {
      try {
        const res = await fetch(
          `${endpoint}/v1/chat-room/events?workspaceId=${encodeURIComponent(workspaceId)}`,
          {
            headers: { ...authHeader, Accept: 'text/event-stream' },
            signal: abort.signal,
          },
        );
        if (!res.ok || !res.body) {
          if (res.status === 401 || res.status === 403 || res.status === 404) return;
          await new Promise((r) => setTimeout(r, 3_000));
          continue;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!abort.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx = buffer.indexOf('\n\n');
          while (idx !== -1) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            for (const line of chunk.split('\n')) {
              if (!line.startsWith('data:')) continue;
              try {
                const parsed = JSON.parse(line.slice(5).trim()) as {
                  type?: string;
                  conversationId?: string;
                  activeTurn?: RemoteVpsChatRoomActiveTurn | null;
                  queue?: RemoteVpsChatRoomQueuedItem[];
                  typingPeers?: Array<{ clientId: string; senderName: string }>;
                  turnEnded?: boolean;
                  endedByClientId?: string;
                };
                if (parsed.type === 'chat-room' && parsed.conversationId) {
                  const typingPeers = Array.isArray(parsed.typingPeers)
                    ? parsed.typingPeers.filter((p) => p.clientId !== clientId).map((p) => p.senderName)
                    : [];
                  emit({
                    workspaceId,
                    conversationId: parsed.conversationId,
                    activeTurn: markSelfTurn(parsed.activeTurn, clientId),
                    queue: markSelfQueue(parsed.queue, clientId),
                    typingPeers,
                    ...(parsed.turnEnded ? { turnEnded: true } : {}),
                    ...(parsed.endedByClientId ? { endedBySelf: parsed.endedByClientId === clientId } : {}),
                  });
                }
              } catch {
                // Ignore malformed SSE frames.
              }
            }
            idx = buffer.indexOf('\n\n');
          }
        }
      } catch {
        if (abort.signal.aborted) return;
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
  }

  const buildVirtualConfig = (workspaceId: string): RemoteVpsWorkspaceConfigDto => ({
    kind: 'vps',
    endpoint,
    remoteWorkspaceId: workspaceId,
    storage: 'vps',
    runtime: 'vps',
    ...(role !== 'admin' ? { shareRole: role as RemoteVpsShareRole } : {}),
    ...(session.shareLabel ? { shareLabel: session.shareLabel } : {}),
  });

  return {
    listSshHosts: async () => ({ ok: true, hosts: [] }),
    getConfig: async (workspaceId) => ({
      ok: true,
      config: buildVirtualConfig(workspaceId),
    }),
    getStatus: async (workspaceId) => {
      try {
        const res = await fetch(`${endpoint}/v1/meta?workspaceId=${encodeURIComponent(workspaceId)}`, {
          headers: authHeader,
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) return { ok: false, connected: false, error: `HTTP ${res.status}` };
        const meta = (await res.json()) as {
          ok?: boolean;
          version?: string;
          bundleHash?: string;
          tailscaleUrl?: string;
          onlineClients?: number;
          role?: string;
        };
        return {
          ok: true,
          connected: Boolean(meta.ok),
          version: meta.version,
          bundleHash: meta.bundleHash,
          tailscaleUrl: meta.tailscaleUrl,
          onlineClients: meta.onlineClients,
          role: meta.role ?? role,
        };
      } catch (err) {
        return {
          ok: false,
          connected: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    saveConfig: async () => ({ ok: false, error: 'VPS configuration is managed from the desktop app.' }),
    removeConfig: async () => ({ ok: false, error: 'VPS configuration is managed from the desktop app.' }),
    testAndBootstrap: async () => ({ ok: false, error: 'SSH bootstrap is only available in the desktop app.' }),
    migrateLocal: async () => ({ ok: false, error: 'Local migration is only available in the desktop app.' }),
    readWorkspaceDoc: async (_workspaceId, cwd) => {
      const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
      const res = await fetch(`${endpoint}/v1/workspace-doc${qs}`, { headers: authHeader });
      return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as {
        ok: boolean;
        exists?: boolean;
        content?: string | null;
        path?: string;
        error?: string;
      };
    },
    writeWorkspaceDoc: async (_workspaceId, content, cwd) => {
      const res = await fetch(`${endpoint}/v1/workspace-doc`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ content, ...(cwd ? { cwd } : {}) }),
      });
      return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as {
        ok: boolean;
        path?: string;
        error?: string;
      };
    },
    listDirs: async (_workspaceId, dirPath, options) => {
      const params = new URLSearchParams();
      if (dirPath) params.set('path', dirPath);
      if (options?.showHidden) params.set('showHidden', '1');
      const res = await fetch(`${endpoint}/v1/fs/list-dirs?${params.toString()}`, { headers: authHeader });
      return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as Awaited<
        ReturnType<RemoteVpsApi['listDirs']>
      >;
    },
    listShares: async (workspaceId) => {
      const res = await fetch(`${endpoint}/v1/shares?workspaceId=${encodeURIComponent(workspaceId)}`, {
        headers: authHeader,
      });
      return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as Awaited<
        ReturnType<RemoteVpsApi['listShares']>
      >;
    },
    createShare: async (workspaceId, options) => {
      const res = await fetch(`${endpoint}/v1/shares`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          workspaceId,
          role: options.role,
          ...(options.label ? { label: options.label } : {}),
          ...(options.expiresInHours ? { expiresInHours: options.expiresInHours } : {}),
        }),
      });
      return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as Awaited<
        ReturnType<RemoteVpsApi['createShare']>
      >;
    },
    revokeShare: async (_workspaceId, shareId) => {
      const res = await fetch(`${endpoint}/v1/shares/${encodeURIComponent(shareId)}`, {
        method: 'DELETE',
        headers: authHeader,
      });
      return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as Awaited<
        ReturnType<RemoteVpsApi['revokeShare']>
      >;
    },
    joinShare: async () => ({ ok: false, error: 'Use a share URL with ?token=... to join from Web.' }),

    getPresence: async (workspaceId) => {
      try {
        const res = await fetch(`${endpoint}/v1/presence?workspaceId=${encodeURIComponent(workspaceId)}`, {
          headers: authHeader,
          signal: AbortSignal.timeout(4_000),
        });
        if (!res.ok) return { ok: false, peers: [] };
        const body = (await res.json()) as { ok?: boolean; peers?: RemoteVpsPresencePeer[] };
        return { ok: Boolean(body.ok), peers: markSelfPeers(body.peers, clientId) };
      } catch {
        return { ok: false, peers: [] };
      }
    },
    updatePresence: async (workspaceId, state) => {
      try {
        const res = await fetch(`${endpoint}/v1/presence`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            workspaceId,
            clientId,
            name: senderName,
            ...state,
          }),
          signal: AbortSignal.timeout(4_000),
        });
        if (!res.ok) return { ok: false, peers: [] };
        const body = (await res.json()) as { ok?: boolean; peers?: RemoteVpsPresencePeer[] };
        return { ok: Boolean(body.ok), peers: markSelfPeers(body.peers, clientId) };
      } catch {
        return { ok: false, peers: [] };
      }
    },
    leavePresence: async (workspaceId) => {
      try {
        await fetch(
          `${endpoint}/v1/presence/${encodeURIComponent(clientId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
          { method: 'DELETE', headers: authHeader, keepalive: true },
        );
      } catch {
        // Ignore leave errors on unload.
      }
      return { ok: true };
    },
    onJoinDeepLink: () => () => {},
    consumePendingJoinLinks: async () => [],

    getChatRoomState: async (workspaceId, conversationId) => {
      try {
        const res = await fetch(
          `${endpoint}/v1/chat-room/state?workspaceId=${encodeURIComponent(workspaceId)}&conversationId=${encodeURIComponent(conversationId)}`,
          { headers: authHeader, signal: AbortSignal.timeout(5_000) },
        );
        if (!res.ok) return { ok: false, fallback: true, activeTurn: null, queue: [] };
        const body = (await res.json()) as {
          ok?: boolean;
          snapshot?: { activeTurn?: RemoteVpsChatRoomActiveTurn | null; queue?: RemoteVpsChatRoomQueuedItem[] };
        };
        return {
          ok: Boolean(body.ok),
          selfName: senderName,
          activeTurn: markSelfTurn(body.snapshot?.activeTurn, clientId),
          queue: markSelfQueue(body.snapshot?.queue, clientId),
        };
      } catch {
        return { ok: false, fallback: true, activeTurn: null, queue: [] };
      }
    },
    enqueueChatRoom: async (workspaceId, conversationId, message) => {
      const { status, body } = await postChatRoom(workspaceId, 'enqueue', { conversationId, message });
      if (status === 403) return { ok: false, forbidden: true };
      const snap = body.snapshot as
        | { activeTurn?: RemoteVpsChatRoomActiveTurn | null; queue?: RemoteVpsChatRoomQueuedItem[] }
        | undefined;
      return {
        ok: Boolean(body.ok),
        claimed: Boolean(body.claimed),
        queuedItem: body.queuedItem
          ? { ...(body.queuedItem as RemoteVpsChatRoomQueuedItem), self: true }
          : undefined,
        activeTurn: markSelfTurn(snap?.activeTurn, clientId),
        queue: markSelfQueue(snap?.queue, clientId),
      };
    },
    claimChatRoom: async (workspaceId, conversationId, options) => {
      const { body } = await postChatRoom(workspaceId, 'claim', {
        conversationId,
        popNext: Boolean(options?.popNext),
      });
      const snap = body.snapshot as
        | { activeTurn?: RemoteVpsChatRoomActiveTurn | null; queue?: RemoteVpsChatRoomQueuedItem[] }
        | undefined;
      return {
        ok: Boolean(body.ok),
        claimed: Boolean(body.claimed),
        nextItem: body.nextItem as RemoteVpsChatRoomQueuedItem | undefined,
        activeTurn: markSelfTurn(snap?.activeTurn, clientId),
        queue: markSelfQueue(snap?.queue, clientId),
      };
    },
    streamChatRoom: async (workspaceId, conversationId, text, toolName) => {
      const { body } = await postChatRoom(workspaceId, 'stream', {
        conversationId,
        text,
        ...(toolName ? { toolName } : {}),
      });
      return { ok: Boolean(body.ok) };
    },
    releaseChatRoom: async (workspaceId, conversationId) => {
      const { body } = await postChatRoom(workspaceId, 'release', { conversationId });
      return { ok: Boolean(body.ok) };
    },
    cancelChatRoomQueued: async (workspaceId, conversationId, itemId) => {
      const { body } = await postChatRoom(workspaceId, 'cancel', { conversationId, itemId });
      return { ok: Boolean(body.ok), removed: Boolean(body.removed) };
    },
    setChatRoomTyping: async (workspaceId, conversationId, active) => {
      const { body } = await postChatRoom(workspaceId, 'typing', { conversationId, active });
      return { ok: Boolean(body.ok) };
    },
    sendChatRoomNote: async (workspaceId, conversationId, message) => {
      const { status, body } = await postChatRoom(workspaceId, 'note', { conversationId, message });
      if (status === 403) return { ok: false, forbidden: true };
      return {
        ok: Boolean(body.ok),
        ...(typeof body.error === 'string' ? { error: body.error } : {}),
      };
    },
    subscribeChatRoom: async (workspaceId) => {
      const existing = activeStreams.get(workspaceId);
      if (existing) {
        existing.refCount += 1;
        return { ok: true };
      }
      const abort = new AbortController();
      activeStreams.set(workspaceId, { refCount: 1, abort });
      void runChatRoomSse(workspaceId, abort);
      return { ok: true };
    },
    unsubscribeChatRoom: async (workspaceId) => {
      const existing = activeStreams.get(workspaceId);
      if (!existing) return { ok: true };
      existing.refCount -= 1;
      if (existing.refCount <= 0) {
        existing.abort.abort();
        activeStreams.delete(workspaceId);
      }
      return { ok: true };
    },
    onChatRoomEvent: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
}
