import { mkdir, realpath } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import {
  isStorageError,
  type PulseStorage,
  type StorageChange,
  type WorkspaceFiles,
} from '@pulse-coder/storage';
import type { StorageRpcRequest } from '@pulse-coder/storage/remote';
import { isPathWithin, readJsonBody, resolveRemoteFilePath, sendJson } from './auth.js';
import {
  canWriteWorkspace,
  isRemoteFileUriAllowed,
  isRpcCallAllowed,
  type AuthPrincipal,
} from './shares.js';

class ForbiddenRpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenRpcError';
  }
}

function normalizeConversationSessionMeta<T>(record: T, fallbackScopeId?: unknown): T {
  if (!record || typeof record !== 'object') return record;
  const rec = record as Record<string, unknown>;
  const meta =
    rec.metadata && typeof rec.metadata === 'object' && !Array.isArray(rec.metadata)
      ? (rec.metadata as Record<string, unknown>)
      : {};
  const existing =
    meta.session && typeof meta.session === 'object' && !Array.isArray(meta.session)
      ? (meta.session as Record<string, unknown>)
      : null;
  if (existing && typeof existing.startedAt === 'string' && typeof existing.workspaceId === 'string') {
    return record;
  }
  const sessionId = typeof rec.sessionId === 'string' ? rec.sessionId : '';
  const workspaceId =
    (typeof existing?.workspaceId === 'string' && existing.workspaceId)
    || (typeof rec.scopeId === 'string' && rec.scopeId)
    || (typeof fallbackScopeId === 'string' && fallbackScopeId)
    || 'default';
  const startedAt =
    (typeof existing?.startedAt === 'string' && existing.startedAt)
    || (typeof meta.updatedAt === 'number' ? new Date(meta.updatedAt).toISOString() : undefined)
    || (typeof meta.date === 'string' && meta.date.length >= 10 ? `${meta.date.slice(0, 10)}T00:00:00.000Z` : undefined)
    || new Date().toISOString();
  const title = typeof meta.title === 'string' && meta.title ? meta.title : undefined;
  return {
    ...rec,
    metadata: {
      ...meta,
      session: {
        ...(existing ?? {}),
        ...(sessionId ? { sessionId } : {}),
        workspaceId,
        startedAt,
        ...(title ? { title } : {}),
      },
    },
  } as T;
}

async function isTargetWithinRealScope(
  dataDir: string,
  scopeRoot: string,
  targetPath: string,
): Promise<boolean> {
  const realDataDir = await realpath(dataDir).catch(() => resolve(dataDir));
  const resolvedScope = resolve(scopeRoot);
  let realScope: string;
  let scopeExists = true;
  try {
    realScope = await realpath(resolvedScope);
    if (!isPathWithin(realDataDir, realScope)) return false;
  } catch {
    scopeExists = false;
    realScope = resolvedScope;
  }

  let cursor = resolve(targetPath);
  while (true) {
    try {
      const realCursor = await realpath(cursor);
      if (scopeExists && isPathWithin(resolvedScope, cursor)) {
        return isPathWithin(realScope, realCursor);
      }
      return isPathWithin(realDataDir, realCursor);
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) return false;
      cursor = parent;
    }
  }
}

function statusForStorageError(code: string): number {
  switch (code) {
    case 'invalid_argument':
      return 400;
    case 'not_found':
      return 404;
    case 'revision_conflict':
    case 'file_write_conflict':
      return 409;
    case 'storage_busy':
      return 503;
    default:
      return 500;
  }
}

function sendStorageError(res: ServerResponse, error: unknown): void {
  if (error instanceof ForbiddenRpcError) {
    sendJson(res, 403, {
      ok: false,
      code: 'forbidden',
      message: error.message,
    });
    return;
  }
  if (isStorageError(error)) {
    sendJson(res, statusForStorageError(error.code), {
      ok: false,
      code: error.code,
      message: error.message,
    });
    return;
  }
  sendJson(res, 500, {
    ok: false,
    code: 'storage_unavailable',
    message: error instanceof Error ? error.message : String(error),
  });
}

async function dispatchRpc(
  storage: PulseStorage,
  principal: AuthPrincipal,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const a = args as any[];
  switch (method) {
    case 'canvas.read':
      return storage.canvas.read(a[0]);
    case 'canvas.list':
      return storage.canvas.list(a[0]);
    case 'canvas.readNode':
      return storage.canvas.readNode(a[0], a[1]);
    case 'canvas.listNodes':
      return storage.canvas.listNodes(a[0], a[1]);
    case 'canvas.commit':
      return storage.canvas.commit(a[0]);
    case 'canvas.remove':
      return storage.canvas.remove(a[0], a[1]);

    case 'workspaces.readBundle':
      return storage.workspaces.readBundle(a[0]);
    case 'workspaces.importBundle':
      return storage.workspaces.importBundle(a[0]);
    case 'workspaces.trashBundle':
      return storage.workspaces.trashBundle(a[0]);
    case 'workspaces.getTrashed':
      return storage.workspaces.getTrashed(a[0]);
    case 'workspaces.listTrashed':
      return storage.workspaces.listTrashed(a[0]);
    case 'workspaces.restoreBundle':
      return storage.workspaces.restoreBundle(a[0], a[1], a[2]);
    case 'workspaces.removeBundle':
      return storage.workspaces.removeBundle(a[0], a[1], a[2], a[3]);

    case 'conversations.read': {
      const snap = await storage.conversations.read(a[0], a[1]);
      return normalizeConversationSessionMeta(snap, a[0]);
    }
    case 'conversations.list': {
      const page = await storage.conversations.list(a[0], a[1]);
      if (!page || !Array.isArray(page.items)) return page;
      return {
        ...page,
        items: page.items.map((item) => normalizeConversationSessionMeta(item, a[0])),
      };
    }
    case 'conversations.commit':
      return storage.conversations.commit(a[0]);
    case 'conversations.remove':
      return storage.conversations.remove(a[0], a[1], a[2]);

    case 'conversationScopes.read':
      return storage.conversationScopes.read(a[0]);
    case 'conversationScopes.list':
      return storage.conversationScopes.list(a[0]);
    case 'conversationScopes.commit':
      return storage.conversationScopes.commit(a[0]);

    case 'fileWrites.get': {
      const record = await storage.fileWrites.get(a[0]);
      if (principal.kind === 'share' && record && record.workspaceId !== principal.share.workspaceId) {
        throw new ForbiddenRpcError('Share token cannot access fileWrites outside its workspace');
      }
      return record;
    }
    case 'fileWrites.list': {
      if (principal.kind === 'share') {
        const request =
          a[0] && typeof a[0] === 'object'
            ? { ...a[0], workspaceId: principal.share.workspaceId }
            : { workspaceId: principal.share.workspaceId };
        return storage.fileWrites.list(request);
      }
      return storage.fileWrites.list(a[0]);
    }
    case 'fileWrites.settle': {
      if (principal.kind === 'share') {
        const existing = await storage.fileWrites.get(a[0]);
        if (existing && existing.workspaceId !== principal.share.workspaceId) {
          throw new ForbiddenRpcError('Share token cannot settle fileWrites outside its workspace');
        }
      }
      return storage.fileWrites.settle(a[0], a[1]);
    }

    case 'changes.read': {
      const page = await storage.changes.read(a[0]);
      if (principal.kind === 'share') {
        return {
          ...page,
          items: page.items.filter((item) => item.scopeId === principal.share.workspaceId),
        };
      }
      return page;
    }
    case 'changes.latestCursor':
      return storage.changes.latestCursor();

    case 'backup':
      return storage.backup(a[0]);
    case 'checkIntegrity':
      return storage.checkIntegrity();
    default:
      return Promise.reject(
        Object.assign(new Error(`Unknown storage RPC method: ${method}`), {
          code: 'invalid_argument',
        }),
      );
  }
}

export async function handleStorageRpc(
  req: IncomingMessage,
  res: ServerResponse,
  storage: PulseStorage,
  principal: AuthPrincipal,
  onMutation?: () => void,
): Promise<void> {
  try {
    const body = await readJsonBody<StorageRpcRequest>(req);
    if (!body || typeof body.method !== 'string' || !Array.isArray(body.args)) {
      sendJson(res, 400, {
        ok: false,
        code: 'invalid_argument',
        message: 'RPC body must contain method and args[]',
      });
      return;
    }
    if (!isRpcCallAllowed(principal, body.method, body.args)) {
      sendJson(res, 403, {
        ok: false,
        code: 'forbidden',
        message: `Insufficient permissions for storage RPC method: ${body.method}`,
      });
      return;
    }
    const result = await dispatchRpc(storage, principal, body.method, body.args);
    if (
      body.method.endsWith('.commit') ||
      body.method.endsWith('.remove') ||
      body.method.includes('Bundle')
    ) {
      onMutation?.();
    }
    sendJson(res, 200, { ok: true, result });
  } catch (error) {
    sendStorageError(res, error);
  }
}

export async function handleFileRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dataDir: string,
  files: WorkspaceFiles,
  principal: AuthPrincipal,
): Promise<void> {
  const remoteUri = url.searchParams.get('uri') ?? '';
  if (!isRemoteFileUriAllowed(principal, remoteUri, dataDir)) {
    sendJson(res, 403, {
      ok: false,
      code: 'forbidden',
      message: 'Share token cannot access files outside its workspace',
    });
    return;
  }
  if ((req.method === 'PUT' || req.method === 'DELETE') && !canWriteWorkspace(principal)) {
    sendJson(res, 403, {
      ok: false,
      code: 'forbidden',
      message: 'Viewer token has read-only file access',
    });
    return;
  }
  const resolved = resolveRemoteFilePath(dataDir, remoteUri);
  if (!resolved) {
    sendJson(res, 400, {
      ok: false,
      code: 'invalid_argument',
      message: `Invalid remote file URI: ${remoteUri}`,
    });
    return;
  }
  if (principal.kind === 'share') {
    const wsRoot = join(dataDir, principal.share.workspaceId);
    if (!(await isTargetWithinRealScope(dataDir, wsRoot, resolved))) {
      sendJson(res, 403, {
        ok: false,
        code: 'forbidden',
        message: 'Share token cannot access files outside its workspace',
      });
      return;
    }
  }
  const localUri = files.uriForPath(resolved);

  try {
    if (req.method === 'GET') {
      const file = await files.readBytes(localUri);
      if (!file) {
        sendJson(res, 404, {
          ok: false,
          code: 'not_found',
          message: `File not found: ${remoteUri}`,
        });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        uri: remoteUri,
        version: file.version,
        base64: Buffer.from(file.bytes).toString('base64'),
      });
      return;
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody<{ base64?: string; expectedVersion?: string | null }>(req);
      if (typeof body.base64 !== 'string') {
        sendJson(res, 400, {
          ok: false,
          code: 'invalid_argument',
          message: 'PUT /v1/files requires base64 content',
        });
        return;
      }
      await mkdir(dirname(resolved), { recursive: true });
      const receipt = await files.write(
        localUri,
        Buffer.from(body.base64, 'base64'),
        'expectedVersion' in body ? { expectedVersion: body.expectedVersion } : undefined,
      );
      sendJson(res, 200, { ok: true, uri: remoteUri, version: receipt.version });
      return;
    }

    if (req.method === 'DELETE') {
      const expectedVersion = url.searchParams.get('expectedVersion') ?? undefined;
      await files.remove(localUri, expectedVersion ? { expectedVersion } : undefined);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, {
      ok: false,
      code: 'invalid_argument',
      message: `Unsupported method: ${req.method}`,
    });
  } catch (error) {
    sendStorageError(res, error);
  }
}

interface ChangeSubscriber {
  res: ServerResponse;
  scopeId?: string;
}

/**
 * Polls SQLite's bounded change-log (also woken immediately on local RPC mutations)
 * and fans out `StorageChange` events over SSE so both daemon commits and external
 * `canvas-cli` writes reach desktop clients in near real time.
 */
export class ChangeBroadcaster {
  private readonly subscribers = new Set<ChangeSubscriber>();
  private cursor: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private readonly storage: PulseStorage,
    private readonly pollIntervalMs = 500,
  ) {}

  async start(): Promise<void> {
    this.cursor = await this.storage.changes.latestCursor();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const sub of this.subscribers) {
      try {
        sub.res.end();
      } catch {
        /* ignore */
      }
    }
    this.subscribers.clear();
  }

  wake(): void {
    void this.poll();
  }

  countSubscribers(scopeId?: string): number {
    if (!scopeId) return this.subscribers.size;
    let count = 0;
    for (const sub of this.subscribers) {
      if (!sub.scopeId || sub.scopeId === scopeId) count += 1;
    }
    return count;
  }

  async subscribe(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const scopeId = url.searchParams.get('scopeId') || undefined;
    const requestedCursor = url.searchParams.get('cursor') || undefined;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    if (requestedCursor) {
      try {
        let cursor: string | undefined = requestedCursor;
        while (cursor !== undefined) {
          const page = await this.storage.changes.read({ cursor, limit: 200 });
          for (const item of page.items) {
            if (!scopeId || item.scopeId === scopeId) {
              res.write(`data: ${JSON.stringify(item)}\n\n`);
            }
          }
          cursor = page.nextCursor;
        }
      } catch {
        // Cursor expired or invalid: client will resync via normal reads; continue streaming live events.
      }
    }

    const subscriber: ChangeSubscriber = { res, scopeId };
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

  private async poll(): Promise<void> {
    if (this.polling || this.subscribers.size === 0 || this.cursor === null) return;
    this.polling = true;
    try {
      let cursor: string | undefined = this.cursor;
      const changes: StorageChange[] = [];
      while (cursor !== undefined) {
        const page = await this.storage.changes.read({ cursor, limit: 200 });
        if (!page.items.length) break;
        changes.push(...page.items);
        this.cursor = page.items[page.items.length - 1].cursor;
        cursor = page.nextCursor;
      }
      for (const change of changes) {
        const frame = `data: ${JSON.stringify(change)}\n\n`;
        for (const sub of this.subscribers) {
          if (sub.scopeId && sub.scopeId !== change.scopeId) continue;
          try {
            sub.res.write(frame);
          } catch {
            this.subscribers.delete(sub);
          }
        }
      }
    } catch {
      // If the cursor expired while idle, reset to latest so streaming recovers.
      try {
        this.cursor = await this.storage.changes.latestCursor();
      } catch {
        /* ignore */
      }
    } finally {
      this.polling = false;
    }
  }
}
