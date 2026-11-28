import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, writeSseFrame } from './auth.js';
import {
  isSafeWorkspaceId,
  resolvePrincipalName,
  scopeClientId,
  type AuthPrincipal,
} from './shares.js';

export interface ChatRoomActiveTurn {
  clientId: string;
  senderName: string;
  conversationId: string;
  /** Monotonic fencing token incremented on every new turn grant. */
  leaseEpoch: number;
  /** Set when the daemon itself runs the turn; clients resume it via `/v1/agent/runs/:runId/events`. */
  runId?: string;
  prompt?: string;
  text: string;
  toolName?: string;
  startedAt: number;
  updatedAt: number;
}

export interface ChatRoomQueuedItem {
  id: string;
  clientId: string;
  senderName: string;
  message: string;
  createdAt: number;
  /** Set for messages queued in the daemon's run hub (dispatched by the daemon). */
  runId?: string;
}

export interface ChatRoomTypingPeer {
  clientId: string;
  senderName: string;
}

export interface ChatRoomSnapshot {
  workspaceId: string;
  conversationId: string;
  activeTurn: ChatRoomActiveTurn | null;
  queue: ChatRoomQueuedItem[];
  typingPeers?: ChatRoomTypingPeer[];
  turnEnded?: boolean;
  endedByClientId?: string;
}

interface RoomState {
  activeTurn: ChatRoomActiveTurn | null;
  queue: ChatRoomQueuedItem[];
  typing: Map<string, { senderName: string; updatedAt: number }>;
  epochSeq: number;
}

interface RoomSubscriber {
  res: ServerResponse;
  workspaceId: string;
}

const LEASE_TTL_MS = 20_000;
const TYPING_TTL_MS = 3_500;
const MAX_QUEUE_PER_CONVERSATION = 50;
const MAX_MESSAGE_CHARS = 16_000;
const MAX_STREAM_PREVIEW_CHARS = 8_000;

/**
 * In-memory coordinator for multi-human x single-agent shared conversations.
 * Serializes turns per (workspaceId, conversationId) via a renewable lease with
 * monotonic fencing tokens (`leaseEpoch`) + FIFO queue and fans out SSE frames.
 */
export class ChatRoomHub {
  private readonly rooms = new Map<string, RoomState>();
  private readonly subscribers = new Set<RoomSubscriber>();
  private eventSeq = 0;
  /** Cancels a daemon-queued run; set by the agent controller. */
  cancelRun?: (workspaceId: string, runId: string) => boolean;

  private key(workspaceId: string, conversationId: string): string {
    return `${workspaceId}::${conversationId}`;
  }

  private getOrCreate(workspaceId: string, conversationId: string, now = Date.now()): RoomState {
    const k = this.key(workspaceId, conversationId);
    let room = this.rooms.get(k);
    if (!room) {
      room = { activeTurn: null, queue: [], typing: new Map(), epochSeq: 0 };
      this.rooms.set(k, room);
    }
    if (room.activeTurn && !room.activeTurn.runId && now - room.activeTurn.updatedAt > LEASE_TTL_MS) {
      room.activeTurn = null;
    }
    for (const [cid, entry] of room.typing) {
      if (now - entry.updatedAt > TYPING_TTL_MS) room.typing.delete(cid);
    }
    return room;
  }

  private snapshot(
    workspaceId: string,
    conversationId: string,
    room: RoomState,
    endedByClientId?: string,
  ): ChatRoomSnapshot {
    const typingPeers: ChatRoomTypingPeer[] = [];
    for (const [clientId, entry] of room.typing) {
      typingPeers.push({ clientId, senderName: entry.senderName });
    }
    return {
      workspaceId,
      conversationId,
      activeTurn: room.activeTurn ? { ...room.activeTurn } : null,
      queue: room.queue.map((item) => ({ ...item })),
      ...(typingPeers.length > 0 ? { typingPeers } : {}),
      ...(endedByClientId ? { turnEnded: true, endedByClientId } : {}),
    };
  }

  private broadcast(snapshot: ChatRoomSnapshot): void {
    const id = ++this.eventSeq;
    const frame = `id: ${id}\ndata: ${JSON.stringify({ type: 'chat-room', ...snapshot })}\n\n`;
    for (const sub of this.subscribers) {
      if (sub.workspaceId !== snapshot.workspaceId) continue;
      if (!writeSseFrame(sub.res, frame)) this.subscribers.delete(sub);
    }
  }

  getState(workspaceId: string, conversationId: string, now = Date.now()): ChatRoomSnapshot {
    const room = this.getOrCreate(workspaceId, conversationId, now);
    return this.snapshot(workspaceId, conversationId, room);
  }

  enqueue(
    workspaceId: string,
    conversationId: string,
    input: { clientId: string; senderName: string; message: string },
    now = Date.now(),
  ): { claimed: boolean; leaseEpoch?: number; queuedItem?: ChatRoomQueuedItem; snapshot: ChatRoomSnapshot } {
    const room = this.getOrCreate(workspaceId, conversationId, now);
    if (!room.activeTurn && room.queue.length === 0) {
      const leaseEpoch = ++room.epochSeq;
      room.activeTurn = {
        clientId: input.clientId,
        senderName: input.senderName,
        conversationId,
        leaseEpoch,
        prompt: input.message.slice(0, MAX_MESSAGE_CHARS),
        text: '',
        startedAt: now,
        updatedAt: now,
      };
      const snap = this.snapshot(workspaceId, conversationId, room);
      this.broadcast(snap);
      return { claimed: true, leaseEpoch, snapshot: snap };
    }

    const item: ChatRoomQueuedItem = {
      id: randomUUID(),
      clientId: input.clientId,
      senderName: input.senderName,
      message: input.message.slice(0, MAX_MESSAGE_CHARS),
      createdAt: now,
    };
    if (room.queue.length >= MAX_QUEUE_PER_CONVERSATION) {
      room.queue.shift();
    }
    room.queue.push(item);
    const snap = this.snapshot(workspaceId, conversationId, room);
    this.broadcast(snap);
    return { claimed: false, queuedItem: item, snapshot: snap };
  }

  claim(
    workspaceId: string,
    conversationId: string,
    input: { clientId: string; senderName: string; popNext?: boolean },
    now = Date.now(),
  ): { claimed: boolean; leaseEpoch?: number; nextItem?: ChatRoomQueuedItem; snapshot: ChatRoomSnapshot } {
    const room = this.getOrCreate(workspaceId, conversationId, now);
    if (room.activeTurn && room.activeTurn.clientId !== input.clientId) {
      return { claimed: false, snapshot: this.snapshot(workspaceId, conversationId, room) };
    }

    let nextItem: ChatRoomQueuedItem | undefined;
    if (input.popNext) {
      const head = room.queue[0];
      if (!head || head.clientId !== input.clientId) {
        return { claimed: false, snapshot: this.snapshot(workspaceId, conversationId, room) };
      }
      nextItem = room.queue.shift();
    }

    const sameHolder = room.activeTurn?.clientId === input.clientId;
    const leaseEpoch = sameHolder && !nextItem ? room.activeTurn!.leaseEpoch : ++room.epochSeq;
    const prompt = nextItem?.message ?? (sameHolder ? room.activeTurn!.prompt : undefined);
    room.activeTurn = {
      clientId: input.clientId,
      senderName: input.senderName,
      conversationId,
      leaseEpoch,
      ...(prompt ? { prompt } : {}),
      text: sameHolder && !nextItem ? room.activeTurn!.text : '',
      toolName: sameHolder && !nextItem ? room.activeTurn!.toolName : undefined,
      startedAt: sameHolder && !nextItem ? room.activeTurn!.startedAt : now,
      updatedAt: now,
    };
    const snap = this.snapshot(workspaceId, conversationId, room);
    this.broadcast(snap);
    return { claimed: true, leaseEpoch, ...(nextItem ? { nextItem } : {}), snapshot: snap };
  }

  updateStream(
    workspaceId: string,
    conversationId: string,
    input: { clientId: string; senderName: string; text: string; prompt?: string; toolName?: string; leaseEpoch?: number },
    now = Date.now(),
  ): { stale?: boolean; snapshot: ChatRoomSnapshot } {
    const room = this.getOrCreate(workspaceId, conversationId, now);
    if (room.activeTurn && room.activeTurn.clientId !== input.clientId) {
      return { stale: true, snapshot: this.snapshot(workspaceId, conversationId, room) };
    }
    if (
      input.leaseEpoch !== undefined
      && (!room.activeTurn || room.activeTurn.leaseEpoch !== input.leaseEpoch)
    ) {
      return { stale: true, snapshot: this.snapshot(workspaceId, conversationId, room) };
    }
    const leaseEpoch = room.activeTurn?.leaseEpoch ?? ++room.epochSeq;
    const prompt = room.activeTurn?.prompt ?? (input.prompt ? input.prompt.slice(0, MAX_MESSAGE_CHARS) : undefined);
    room.activeTurn = {
      clientId: input.clientId,
      senderName: input.senderName,
      conversationId,
      leaseEpoch,
      ...(room.activeTurn?.runId ? { runId: room.activeTurn.runId } : {}),
      ...(prompt ? { prompt } : {}),
      text: input.text.slice(-MAX_STREAM_PREVIEW_CHARS),
      ...(input.toolName ? { toolName: input.toolName.slice(0, 128) } : {}),
      startedAt: room.activeTurn?.startedAt ?? now,
      updatedAt: now,
    };
    const snap = this.snapshot(workspaceId, conversationId, room);
    this.broadcast(snap);
    return { snapshot: snap };
  }

  release(
    workspaceId: string,
    conversationId: string,
    clientId: string,
    leaseEpoch?: number,
    now = Date.now(),
  ): { stale?: boolean; snapshot: ChatRoomSnapshot } {
    const room = this.getOrCreate(workspaceId, conversationId, now);
    const owned = room.activeTurn?.clientId === clientId;
    if (!owned) {
      return { stale: true, snapshot: this.snapshot(workspaceId, conversationId, room) };
    }
    if (leaseEpoch !== undefined && room.activeTurn!.leaseEpoch !== leaseEpoch) {
      return { stale: true, snapshot: this.snapshot(workspaceId, conversationId, room) };
    }
    room.activeTurn = null;
    const snap = this.snapshot(workspaceId, conversationId, room, clientId);
    this.broadcast(snap);
    return { snapshot: snap };
  }

  /**
   * Mirror the daemon run hub's state for one conversation: the running run
   * becomes the active turn, and its queued runs replace the run-backed queue
   * items. Client-queued items (older clients) are kept. Clearing the active
   * turn broadcasts `turnEnded` so peers reload the persisted reply.
   */
  setRun(
    workspaceId: string,
    conversationId: string,
    active: { runId: string; clientId: string; senderName: string; prompt: string; startedAt?: number } | null,
    queued: Array<{ runId: string; clientId: string; senderName: string; prompt: string; createdAt: number }>,
    now = Date.now(),
  ): ChatRoomSnapshot {
    const room = this.getOrCreate(workspaceId, conversationId, now);
    const previous = room.activeTurn;
    let endedBy: string | undefined;
    if (active) {
      if (previous?.runId !== active.runId) {
        room.activeTurn = {
          clientId: active.clientId,
          senderName: active.senderName,
          conversationId,
          leaseEpoch: ++room.epochSeq,
          runId: active.runId,
          prompt: active.prompt.slice(0, MAX_MESSAGE_CHARS),
          text: '',
          startedAt: active.startedAt ?? now,
          updatedAt: now,
        };
        if (previous?.runId) endedBy = previous.clientId;
      }
    } else if (previous?.runId) {
      room.activeTurn = null;
      endedBy = previous.clientId;
    }
    room.queue = [
      ...room.queue.filter((item) => !item.runId),
      ...queued.map((run) => ({
        id: run.runId,
        runId: run.runId,
        clientId: run.clientId,
        senderName: run.senderName,
        message: run.prompt.slice(0, MAX_MESSAGE_CHARS),
        createdAt: run.createdAt,
      })),
    ];
    const snap = this.snapshot(workspaceId, conversationId, room, endedBy);
    this.broadcast(snap);
    return snap;
  }

  cancelQueued(
    workspaceId: string,
    conversationId: string,
    itemId: string,
    clientId: string,
    isAdmin: boolean,
    now = Date.now(),
  ): { removed: boolean; snapshot: ChatRoomSnapshot } {
    const room = this.getOrCreate(workspaceId, conversationId, now);
    const idx = room.queue.findIndex(
      (item) => item.id === itemId && (isAdmin || item.clientId === clientId),
    );
    if (idx === -1) {
      return { removed: false, snapshot: this.snapshot(workspaceId, conversationId, room) };
    }
    const runId = room.queue[idx].runId;
    if (runId) {
      // The run hub owns the item; its change callback rebroadcasts the queue.
      const removed = this.cancelRun?.(workspaceId, runId) ?? false;
      return { removed, snapshot: this.snapshot(workspaceId, conversationId, room) };
    }
    room.queue.splice(idx, 1);
    const snap = this.snapshot(workspaceId, conversationId, room);
    this.broadcast(snap);
    return { removed: true, snapshot: snap };
  }

  setTyping(
    workspaceId: string,
    conversationId: string,
    input: { clientId: string; senderName: string; active: boolean },
    now = Date.now(),
  ): ChatRoomSnapshot {
    const room = this.getOrCreate(workspaceId, conversationId, now);
    if (input.active) {
      room.typing.set(input.clientId, { senderName: input.senderName, updatedAt: now });
    } else {
      room.typing.delete(input.clientId);
    }
    const snap = this.snapshot(workspaceId, conversationId, room);
    this.broadcast(snap);
    return snap;
  }

  notifyNote(workspaceId: string, conversationId: string, clientId: string, now = Date.now()): ChatRoomSnapshot {
    const room = this.getOrCreate(workspaceId, conversationId, now);
    room.typing.delete(clientId);
    const snap = this.snapshot(workspaceId, conversationId, room, clientId);
    this.broadcast(snap);
    return snap;
  }

  subscribe(req: IncomingMessage, res: ServerResponse, workspaceId: string): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const now = Date.now();
    const prefix = `${workspaceId}::`;
    for (const [k, room] of this.rooms) {
      if (!k.startsWith(prefix)) continue;
      if (room.activeTurn && !room.activeTurn.runId && now - room.activeTurn.updatedAt > LEASE_TTL_MS) {
        room.activeTurn = null;
      }
      if (!room.activeTurn && room.queue.length === 0) continue;
      const conversationId = k.slice(prefix.length);
      const snap = this.snapshot(workspaceId, conversationId, room);
      res.write(`data: ${JSON.stringify({ type: 'chat-room', ...snap })}\n\n`);
    }

    const subscriber: RoomSubscriber = { res, workspaceId };
    this.subscribers.add(subscriber);

    const keepalive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }, 20_000);
    keepalive.unref();

    req.on('close', () => {
      clearInterval(keepalive);
      this.subscribers.delete(subscriber);
    });
  }

  stop(): void {
    for (const sub of this.subscribers) {
      try {
        sub.res.end();
      } catch {
        /* ignore */
      }
    }
    this.subscribers.clear();
  }
}

export async function handleChatRoomRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  principal: AuthPrincipal,
  hub: ChatRoomHub,
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/chat-room/')) return false;

  const tokenWs = principal.kind === 'share' ? principal.share.workspaceId : '';
  const queryWs = url.searchParams.get('workspaceId')?.trim() || '';
  const resolveWs = (bodyWs?: string): string | null => {
    const candidate = (typeof bodyWs === 'string' ? bodyWs.trim() : '') || queryWs;
    const wsId = tokenWs || candidate;
    if (!isSafeWorkspaceId(wsId) || (tokenWs && candidate && candidate !== tokenWs)) return null;
    return wsId;
  };

  if (req.method === 'GET' && url.pathname === '/v1/chat-room/events') {
    const wsId = resolveWs();
    if (!wsId) {
      sendJson(res, 400, { ok: false, code: 'invalid_argument', message: 'valid workspaceId is required' });
      return true;
    }
    hub.subscribe(req, res, wsId);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/chat-room/state') {
    const wsId = resolveWs();
    const convId = url.searchParams.get('conversationId')?.trim() || '';
    if (!wsId || !convId) {
      sendJson(res, 400, { ok: false, code: 'invalid_argument', message: 'valid workspaceId and conversationId are required' });
      return true;
    }
    sendJson(res, 200, { ok: true, ...hub.getState(wsId, convId) });
    return true;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, code: 'method_not_allowed', message: 'Unsupported method' });
    return true;
  }

  if (principal.kind === 'share' && principal.share.role === 'viewer') {
    sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Viewer role cannot send messages in shared chat room' });
    return true;
  }

  try {
    const body = await readJsonBody<{
      workspaceId?: string;
      conversationId?: string;
      clientId?: string;
      senderName?: string;
      message?: string;
      text?: string;
      toolName?: string;
      leaseEpoch?: number;
      popNext?: boolean;
      itemId?: string;
      active?: boolean;
    }>(req);

    const wsId = resolveWs(body.workspaceId);
    const convId = typeof body.conversationId === 'string' ? body.conversationId.trim().slice(0, 128) : '';
    const rawClientId = typeof body.clientId === 'string' ? body.clientId.trim().slice(0, 64) : '';
    if (!wsId || !convId || !rawClientId) {
      sendJson(res, 400, { ok: false, code: 'invalid_argument', message: 'valid workspaceId, conversationId, and clientId are required' });
      return true;
    }
    const clientId = scopeClientId(principal, rawClientId);
    const senderName = resolvePrincipalName(principal, body.senderName);
    const leaseEpoch = typeof body.leaseEpoch === 'number' && Number.isInteger(body.leaseEpoch)
      ? body.leaseEpoch
      : undefined;

    if (url.pathname === '/v1/chat-room/enqueue') {
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message) {
        sendJson(res, 400, { ok: false, code: 'invalid_argument', message: 'message is required' });
        return true;
      }
      const result = hub.enqueue(wsId, convId, { clientId, senderName, message });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    if (url.pathname === '/v1/chat-room/claim') {
      const result = hub.claim(wsId, convId, {
        clientId,
        senderName,
        popNext: Boolean(body.popNext),
      });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    if (url.pathname === '/v1/chat-room/stream') {
      const text = typeof body.text === 'string' ? body.text : '';
      const toolName = typeof body.toolName === 'string' ? body.toolName : undefined;
      const result = hub.updateStream(wsId, convId, { clientId, senderName, text, toolName, leaseEpoch });
      if (result.stale) {
        sendJson(res, 409, { ok: false, code: 'stale_lease', snapshot: result.snapshot });
        return true;
      }
      sendJson(res, 200, { ok: true, snapshot: result.snapshot });
      return true;
    }

    if (url.pathname === '/v1/chat-room/release') {
      const result = hub.release(wsId, convId, clientId, leaseEpoch);
      if (result.stale) {
        sendJson(res, 409, { ok: false, code: 'stale_lease', snapshot: result.snapshot });
        return true;
      }
      sendJson(res, 200, { ok: true, snapshot: result.snapshot });
      return true;
    }

    if (url.pathname === '/v1/chat-room/cancel') {
      const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
      if (!itemId) {
        sendJson(res, 400, { ok: false, code: 'invalid_argument', message: 'itemId is required' });
        return true;
      }
      const result = hub.cancelQueued(wsId, convId, itemId, clientId, principal.kind === 'admin');
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    if (url.pathname === '/v1/chat-room/typing') {
      const active = Boolean(body.active);
      const snapshot = hub.setTyping(wsId, convId, { clientId, senderName, active });
      sendJson(res, 200, { ok: true, snapshot });
      return true;
    }

    if (url.pathname === '/v1/chat-room/note') {
      const snapshot = hub.notifyNote(wsId, convId, clientId);
      sendJson(res, 200, { ok: true, snapshot });
      return true;
    }

    sendJson(res, 404, { ok: false, code: 'not_found', message: `Unknown chat-room route: ${url.pathname}` });
    return true;
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}

