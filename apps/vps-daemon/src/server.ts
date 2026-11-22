import { mkdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { createLocalWorkspaceFiles } from '@pulse-coder/storage/local-workspace-files';
import { openSqliteStorage, type SqliteStorage } from '@pulse-coder/storage/sqlite';
import { sendJson, verifyBearerToken } from './auth.js';
import { handleExecJsonl } from './exec-jsonl.js';
import { PtyHub, type PtySpawner } from './pty-hub.js';
import { ChangeBroadcaster, handleFileRequest, handleStorageRpc } from './storage-rpc.js';

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
 * SSE change streaming, persistent PTY sessions, and streaming JSONL CLI execution.
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

  const files = createLocalWorkspaceFiles();
  const broadcaster = new ChangeBroadcaster(storage, options.pollIntervalMs ?? 500);
  await broadcaster.start();
  const ptyHub = new PtyHub(workDir, options.ptySpawner);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, version: DAEMON_VERSION });
      return;
    }

    if (!verifyBearerToken(req, options.token)) {
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
        capabilities: ['storage-rpc', 'workspace-files', 'sse-events', 'pty', 'exec-jsonl'],
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/storage/rpc') {
      await handleStorageRpc(req, res, storage, () => broadcaster.wake());
      return;
    }

    if (url.pathname === '/v1/files') {
      await handleFileRequest(req, res, url, dataDir, files);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/events') {
      await broadcaster.subscribe(req, res, url);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/exec-jsonl') {
      await handleExecJsonl(req, res, workDir);
      return;
    }

    if (await ptyHub.handleHttp(req, res, url)) {
      return;
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
