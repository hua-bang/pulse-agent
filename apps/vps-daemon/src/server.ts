import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createLocalWorkspaceFiles } from '@pulse-coder/storage/local-workspace-files';
import { openSqliteStorage, type SqliteStorage } from '@pulse-coder/storage/sqlite';
import { readJsonBody, sendJson } from './auth.js';
import { handleExecJsonl } from './exec-jsonl.js';
import { PtyHub, type PtySpawner } from './pty-hub.js';
import {
  canUseRuntime,
  canWriteWorkspace,
  isValidShareRole,
  ShareTokenStore,
} from './shares.js';
import { ChangeBroadcaster, handleFileRequest, handleStorageRpc } from './storage-rpc.js';
import { handleToolExecRequest } from './tools-rpc.js';

export interface VpsDaemonOptions {
  host?: string;
  port?: number;
  token: string;
  dataDir: string;
  workDir?: string;
  pollIntervalMs?: number;
  ptySpawner?: PtySpawner;
}

export interface RunningVpsDaemon {
  readonly server: Server;
  readonly storage: SqliteStorage;
  readonly ptyHub: PtyHub;
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

const DAEMON_VERSION = '0.1.0';
const DATABASE_FILE = '__storage__.sqlite';

/**
 * Start a lightweight VPS daemon exposing `@pulse-coder/storage`, `WorkspaceFiles`,
 * SSE change streaming, persistent PTY sessions, streaming JSONL CLI execution,
 * and scoped workspace share tokens.
 */
export async function startVpsDaemon(options: VpsDaemonOptions): Promise<RunningVpsDaemon> {
  if (!options.token.trim()) {
    throw new Error('PULSE_VPS_TOKEN is required to start vps-daemon.');
  }
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4770;
  const dataDir = resolve(options.dataDir);
  const workDir = resolve(options.workDir ?? dataDir);

  await mkdir(dataDir, { recursive: true });
  await mkdir(workDir, { recursive: true });

  const storage = await openSqliteStorage({ path: join(dataDir, DATABASE_FILE) });
  // Ensure canvas and conversations domains are marked active so local canvas-cli
  // running on the same VPS can interoperate with this database directly.
  const states = await storage.localActivation.read();
  for (const domain of ['canvas', 'conversations'] as const) {
    if (!states.some((s) => s.domain === domain && s.state === 'active')) {
      await storage.localActivation.begin(domain);
      await storage.localActivation.complete(domain);
    }
  }

  const shareStore = new ShareTokenStore(dataDir);
  await shareStore.load();

  const files = createLocalWorkspaceFiles();
  const broadcaster = new ChangeBroadcaster(storage, options.pollIntervalMs ?? 500);
  await broadcaster.start();
  const ptyHub = new PtyHub(workDir, options.ptySpawner, dataDir);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, version: DAEMON_VERSION });
      return;
    }

    const principal = shareStore.authenticate(req, options.token);
    if (!principal) {
      sendJson(res, 401, {
        ok: false,
        code: 'unauthorized',
        message: 'Invalid or missing Bearer token',
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/meta') {
      sendJson(res, 200, {
        ok: true,
        generation: storage.generation,
        version: DAEMON_VERSION,
        role: principal.kind === 'admin' ? 'admin' : principal.share.role,
        ...(principal.kind === 'share' ? { workspaceId: principal.share.workspaceId } : {}),
        capabilities: [
          'storage-rpc',
          'workspace-files',
          'sse-events',
          'pty',
          'exec-jsonl',
          'fs-list-dirs',
          'shares',
        ],
      });
      return;
    }

    if (url.pathname === '/v1/shares' || url.pathname.startsWith('/v1/shares/')) {
      if (principal.kind !== 'admin') {
        sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Admin token required for share management' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/shares') {
        const wsId = url.searchParams.get('workspaceId')?.trim() || undefined;
        sendJson(res, 200, { ok: true, shares: shareStore.list(wsId) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/shares') {
        try {
          const body = await readJsonBody<{
            workspaceId?: string;
            role?: string;
            label?: string;
            expiresInHours?: number;
          }>(req);
          if (!body.workspaceId?.trim() || !isValidShareRole(body.role)) {
            sendJson(res, 400, { ok: false, code: 'invalid_argument', message: 'workspaceId and valid role are required' });
            return;
          }
          const share = await shareStore.create({
            workspaceId: body.workspaceId,
            role: body.role,
            label: body.label,
            expiresInHours: body.expiresInHours,
          });
          sendJson(res, 200, { ok: true, share });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/v1/shares/')) {
        const shareId = decodeURIComponent(url.pathname.slice('/v1/shares/'.length));
        const revoked = await shareStore.revoke(shareId);
        sendJson(res, 200, { ok: true, revoked });
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/storage/rpc') {
      await handleStorageRpc(req, res, storage, principal, () => broadcaster.wake());
      return;
    }

    if (url.pathname === '/v1/files') {
      await handleFileRequest(req, res, url, dataDir, files, principal);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/events') {
      if (principal.kind === 'share') {
        url.searchParams.set('scopeId', principal.share.workspaceId);
      }
      await broadcaster.subscribe(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/fs/list-dirs') {
      if (!canUseRuntime(principal)) {
        sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Collaborator or admin role required to browse remote directories' });
        return;
      }
      try {
        const home = homedir();
        const rawPath = url.searchParams.get('path')?.trim() || '';
        const showHidden = url.searchParams.get('showHidden') === '1';
        const expanded = !rawPath || rawPath === '~'
          ? workDir || home
          : rawPath.startsWith('~/')
            ? join(home, rawPath.slice(2))
            : rawPath;
        const targetDir = resolve(expanded);
        const dirents = await readdir(targetDir, { withFileTypes: true });
        const entries: Array<{ name: string; path: string; hidden: boolean }> = [];
        for (const dirent of dirents) {
          const hidden = dirent.name.startsWith('.');
          if (!showHidden && hidden) continue;
          const entryPath = join(targetDir, dirent.name);
          let isDir = dirent.isDirectory();
          if (!isDir && dirent.isSymbolicLink()) {
            try {
              const info = await stat(entryPath);
              isDir = info.isDirectory();
            } catch {
              isDir = false;
            }
          }
          if (isDir) {
            entries.push({ name: dirent.name, path: entryPath, hidden });
          }
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        const parentDir = dirname(targetDir);
        sendJson(res, 200, {
          ok: true,
          path: targetDir,
          parent: parentDir !== targetDir ? parentDir : null,
          home,
          entries,
        });
      } catch (err) {
        sendJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (url.pathname === '/v1/workspace-doc') {
      if (req.method === 'GET') {
        const dir = resolve(url.searchParams.get('cwd')?.trim() || workDir);
        const docPath = join(dir, 'pulse-workspace.md');
        try {
          const content = await readFile(docPath, 'utf8');
          sendJson(res, 200, { ok: true, exists: true, content, path: docPath });
        } catch (err) {
          const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
          if (code === 'ENOENT') {
            sendJson(res, 200, { ok: true, exists: false, content: null, path: docPath });
          } else {
            sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
          }
        }
        return;
      }
      if (req.method === 'PUT') {
        if (!canWriteWorkspace(principal)) {
          sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Editor or collaborator role required to edit pulse-workspace.md' });
          return;
        }
        try {
          const body = await readJsonBody<{ cwd?: string; content?: string }>(req);
          if (typeof body.content !== 'string') {
            sendJson(res, 400, { ok: false, error: 'Missing content string' });
            return;
          }
          const dir = resolve(body.cwd?.trim() || workDir);
          await mkdir(dir, { recursive: true });
          const docPath = join(dir, 'pulse-workspace.md');
          await writeFile(docPath, body.content, 'utf8');
          sendJson(res, 200, { ok: true, path: docPath });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/exec-jsonl') {
      if (!canUseRuntime(principal)) {
        sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Collaborator or admin role required to execute remote commands' });
        return;
      }
      await handleExecJsonl(req, res, workDir);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/tools/exec') {
      await handleToolExecRequest(req, res, principal, readJsonBody, sendJson);
      return;
    }

    if (url.pathname.startsWith('/v1/pty/')) {
      if (req.method !== 'GET' && !canUseRuntime(principal)) {
        sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Collaborator or admin role required to control remote terminals' });
        return;
      }
      if (await ptyHub.handleHttp(req, res, url)) {
        return;
      }
    }

    sendJson(res, 404, {
      ok: false,
      code: 'not_found',
      message: `Route not found: ${req.method} ${url.pathname}`,
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  const boundUrl = `http://${host}:${boundPort}`;

  return {
    server,
    storage,
    ptyHub,
    url: boundUrl,
    port: boundPort,
    async close() {
      broadcaster.stop();
      ptyHub.closeAll();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await storage.close();
    },
  };
}
