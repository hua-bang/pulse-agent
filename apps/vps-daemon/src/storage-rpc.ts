import { mkdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import {
  isStorageError,
  type PulseStorage,
  type StorageChange,
  type WorkspaceFiles,
} from '@pulse-coder/storage';
import type { StorageRpcRequest } from '@pulse-coder/storage/remote';
import { readJsonBody, resolveRemoteFilePath, sendJson } from './auth.js';

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

    case 'conversations.read':
      return storage.conversations.read(a[0], a[1]);
    case 'conversations.list':
      return storage.conversations.list(a[0], a[1]);
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

    case 'fileWrites.get':
      return storage.fileWrites.get(a[0]);
    case 'fileWrites.list':
      return storage.fileWrites.list(a[0]);
    case 'fileWrites.settle':
      return storage.fileWrites.settle(a[0], a[1]);

    case 'changes.read':
      return storage.changes.read(a[0]);
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
    const result = await dispatchRpc(storage, body.method, body.args);
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
): Promise<void> {
  const remoteUri = url.searchParams.get('uri') ?? '';
  const resolved = resolveRemoteFilePath(dataDir, remoteUri);
  if (!resolved) {
    sendJson(res, 400, {
      ok: false,
      code: 'invalid_argument',
      message: `Invalid remote file URI: ${remoteUri}`,
    });
    return;
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
