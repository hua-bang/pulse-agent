import { randomUUID } from 'node:crypto';
import { BrowserWindow, ipcMain } from 'electron';
import type {
  RemoteVpsChatRoomActiveTurn,
  RemoteVpsChatRoomEvent,
  RemoteVpsChatRoomQueuedItem,
} from '../../../shared/api/remote-vps';

const activeStreams = new Map<string, { refCount: number; abort: AbortController }>();

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

function broadcastEvent(event: RemoteVpsChatRoomEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('remote-vps:chat-room-event', event);
    }
  }
}

async function postChatRoom(
  workspaceId: string,
  path: string,
  clientId: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, any> } | null> {
  const [{ resolveRemoteWorkspaceTarget }, { resolveRemoteWorkspaceSenderName }] = await Promise.all([
    import('../client'),
    import('../config'),
  ]);
  const target = await resolveRemoteWorkspaceTarget(workspaceId, 'storage');
  if (!target) return null;
  const senderName = resolveRemoteWorkspaceSenderName(workspaceId);
  const res = await fetch(`${target.endpoint}/v1/chat-room/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${target.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workspaceId: target.remoteWorkspaceId,
      clientId,
      ...(senderName ? { senderName } : {}),
      ...payload,
    }),
    signal: AbortSignal.timeout(4_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, body };
}

async function runSseLoop(workspaceId: string, selfId: string, abort: AbortController): Promise<void> {
  const { resolveRemoteWorkspaceTarget } = await import('../client');
  while (!abort.signal.aborted) {
    try {
      const target = await resolveRemoteWorkspaceTarget(workspaceId, 'storage');
      if (!target) return;
      const res = await fetch(
        `${target.endpoint}/v1/chat-room/events?workspaceId=${encodeURIComponent(target.remoteWorkspaceId)}`,
        {
          headers: { Authorization: `Bearer ${target.token}`, Accept: 'text/event-stream' },
          signal: abort.signal,
        },
      );
      if (!res.ok || !res.body) {
        if (res.status === 404 || res.status === 401 || res.status === 403) return;
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
              const parsed = JSON.parse(line.slice(5).trim()) as Omit<RemoteVpsChatRoomEvent, 'typingPeers'> & {
                type?: string;
                endedByClientId?: string;
                typingPeers?: Array<{ clientId: string; senderName: string }>;
              };
              if (parsed.type === 'chat-room' && parsed.conversationId) {
                const typingPeers = Array.isArray(parsed.typingPeers)
                  ? parsed.typingPeers.filter((p) => p.clientId !== selfId).map((p) => p.senderName)
                  : [];
                broadcastEvent({
                  workspaceId,
                  conversationId: parsed.conversationId,
                  activeTurn: markSelfTurn(parsed.activeTurn, selfId),
                  queue: markSelfQueue(parsed.queue, selfId),
                  typingPeers,
                  ...(parsed.turnEnded ? { turnEnded: true } : {}),
                  ...(parsed.endedByClientId ? { endedBySelf: parsed.endedByClientId === selfId } : {}),
                });
              }
            } catch {
              /* ignore malformed frame */
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

export function registerRemoteChatRoomIpc(selfClientId: string): void {
  ipcMain.handle(
    'remote-vps:chatRoomState',
    async (_e, p: { workspaceId: string; conversationId: string }) => {
      try {
        const [{ resolveRemoteWorkspaceTarget }, { resolveRemoteWorkspaceSenderName }] = await Promise.all([
          import('../client'),
          import('../config'),
        ]);
        const target = await resolveRemoteWorkspaceTarget(p.workspaceId, 'storage');
        if (!target) return { ok: true, fallback: true, activeTurn: null, queue: [] };
        const selfName = resolveRemoteWorkspaceSenderName(p.workspaceId);
        const res = await fetch(
          `${target.endpoint}/v1/chat-room/state?workspaceId=${encodeURIComponent(target.remoteWorkspaceId)}&conversationId=${encodeURIComponent(p.conversationId)}`,
          { headers: { Authorization: `Bearer ${target.token}` }, signal: AbortSignal.timeout(4_000) },
        );
        if (res.status === 404) return { ok: true, fallback: true, selfName, activeTurn: null, queue: [] };
        if (!res.ok) return { ok: false, selfName, activeTurn: null, queue: [] };
        const body = (await res.json()) as Record<string, any>;
        return {
          ok: true,
          selfName,
          activeTurn: markSelfTurn(body.activeTurn, selfClientId),
          queue: markSelfQueue(body.queue, selfClientId),
        };
      } catch {
        return { ok: false, fallback: true, activeTurn: null, queue: [] };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:chatRoomEnqueue',
    async (_e, p: { workspaceId: string; conversationId: string; message: string }) => {
      try {
        const res = await postChatRoom(p.workspaceId, 'enqueue', selfClientId, {
          conversationId: p.conversationId,
          message: p.message,
        });
        if (!res || res.status === 404) return { ok: true, fallback: true };
        if (res.status === 403) return { ok: false, forbidden: true };
        if (res.status >= 400) return { ok: false, fallback: true };
        return {
          ok: true,
          claimed: Boolean(res.body.claimed),
          queuedItem: res.body.queuedItem
            ? { ...res.body.queuedItem, self: res.body.queuedItem.clientId === selfClientId }
            : undefined,
          activeTurn: markSelfTurn(res.body.snapshot?.activeTurn, selfClientId),
          queue: markSelfQueue(res.body.snapshot?.queue, selfClientId),
        };
      } catch {
        return { ok: true, fallback: true };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:chatRoomClaim',
    async (_e, p: { workspaceId: string; conversationId: string; popNext?: boolean }) => {
      try {
        const res = await postChatRoom(p.workspaceId, 'claim', selfClientId, {
          conversationId: p.conversationId,
          popNext: Boolean(p.popNext),
        });
        if (!res || res.status >= 400) return { ok: false, claimed: false };
        return {
          ok: true,
          claimed: Boolean(res.body.claimed),
          nextItem: res.body.nextItem
            ? { ...res.body.nextItem, self: res.body.nextItem.clientId === selfClientId }
            : undefined,
          activeTurn: markSelfTurn(res.body.snapshot?.activeTurn, selfClientId),
          queue: markSelfQueue(res.body.snapshot?.queue, selfClientId),
        };
      } catch {
        return { ok: false, claimed: false };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:chatRoomStream',
    async (_e, p: { workspaceId: string; conversationId: string; text: string; toolName?: string }) => {
      try {
        const res = await postChatRoom(p.workspaceId, 'stream', selfClientId, {
          conversationId: p.conversationId,
          text: p.text,
          ...(p.toolName ? { toolName: p.toolName } : {}),
        });
        return { ok: Boolean(res && res.status < 400) };
      } catch {
        return { ok: false };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:chatRoomRelease',
    async (_e, p: { workspaceId: string; conversationId: string }) => {
      try {
        const res = await postChatRoom(p.workspaceId, 'release', selfClientId, {
          conversationId: p.conversationId,
        });
        return { ok: Boolean(res && res.status < 400) };
      } catch {
        return { ok: false };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:chatRoomCancel',
    async (_e, p: { workspaceId: string; conversationId: string; itemId: string }) => {
      try {
        const res = await postChatRoom(p.workspaceId, 'cancel', selfClientId, {
          conversationId: p.conversationId,
          itemId: p.itemId,
        });
        return { ok: Boolean(res && res.status < 400), removed: Boolean(res?.body.removed) };
      } catch {
        return { ok: false, removed: false };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:chatRoomTyping',
    async (_e, p: { workspaceId: string; conversationId: string; active: boolean }) => {
      try {
        const res = await postChatRoom(p.workspaceId, 'typing', selfClientId, {
          conversationId: p.conversationId,
          active: Boolean(p.active),
        });
        return { ok: Boolean(res && res.status < 400) };
      } catch {
        return { ok: false };
      }
    },
  );

  ipcMain.handle(
    'remote-vps:chatRoomNote',
    async (_e, p: { workspaceId: string; conversationId: string; message: string }) => {
      try {
        const text = typeof p.message === 'string' ? p.message.trim() : '';
        if (!text) return { ok: false, error: 'Empty message' };
        const [{ getRemoteWorkspaceConfig, resolveRemoteWorkspaceSenderName }, { getRemotePulseStorage }] =
          await Promise.all([import('../config'), import('../client')]);
        if (getRemoteWorkspaceConfig(p.workspaceId)?.shareRole === 'viewer') {
          return { ok: false, forbidden: true };
        }
        const resolved = await getRemotePulseStorage(p.workspaceId);
        if (!resolved) return { ok: false, error: 'Remote storage unavailable' };
        const existing = await resolved.storage.conversations.read(
          resolved.target.remoteWorkspaceId,
          p.conversationId,
        );
        if (!existing) return { ok: false, error: 'Conversation not found' };
        const senderName = resolveRemoteWorkspaceSenderName(p.workspaceId);
        const now = Date.now();
        await resolved.storage.conversations.commit({
          scopeId: resolved.target.remoteWorkspaceId,
          sessionId: p.conversationId,
          expectedRevision: existing.revision,
          expectedGeneration: existing.generation,
          metadata: { ...existing.metadata, updatedAt: now },
          appendMessages: [
            {
              id: `message-${randomUUID()}`,
              role: 'user',
              content: text,
              timestamp: now,
              ...(senderName ? { senderName } : {}),
            },
          ],
        });
        await postChatRoom(p.workspaceId, 'note', selfClientId, {
          conversationId: p.conversationId,
        }).catch(() => undefined);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('remote-vps:chatRoomSubscribe', async (_e, p: { workspaceId: string }) => {
    const existing = activeStreams.get(p.workspaceId);
    if (existing) {
      existing.refCount += 1;
      return { ok: true };
    }
    const abort = new AbortController();
    activeStreams.set(p.workspaceId, { refCount: 1, abort });
    void runSseLoop(p.workspaceId, selfClientId, abort);
    return { ok: true };
  });

  ipcMain.handle('remote-vps:chatRoomUnsubscribe', async (_e, p: { workspaceId: string }) => {
    const existing = activeStreams.get(p.workspaceId);
    if (!existing) return { ok: true };
    existing.refCount -= 1;
    if (existing.refCount <= 0) {
      activeStreams.delete(p.workspaceId);
      existing.abort.abort();
    }
    return { ok: true };
  });
}
