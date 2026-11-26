import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLocalWorkspaceFiles } from '@pulse-coder/storage/local-workspace-files';
import { openSqliteStorage, type SqliteStorage } from '@pulse-coder/storage/sqlite';
import { isPathWithin, readJsonBody, sendJson } from './auth.js';
import { CapabilityRelay, type RelayResponsePayload } from './capability-relay.js';
import { handleExecJsonl } from './exec-jsonl.js';
import { PresenceHub, type PresenceViewport } from './presence.js';
import { PtyHub, type PtySpawner } from './pty-hub.js';
import {
  canUseRuntime,
  canWriteWorkspace,
  isSafeWorkspaceId,
  isValidShareRole,
  ShareTokenStore,
  type AuthPrincipal,
} from './shares.js';
import { ChangeBroadcaster, handleFileRequest, handleStorageRpc } from './storage-rpc.js';
import { handleToolExecRequest } from './tools-rpc.js';

const execFileAsync = promisify(execFile);

export interface VpsDaemonOptions {
  host?: string;
  port?: number;
  token: string;
  dataDir: string;
  workDir?: string;
  pollIntervalMs?: number;
  ptySpawner?: PtySpawner;
  writeRuntimeDescriptor?: boolean;
  bundleHash?: string;
}

export interface RunningVpsDaemon {
  readonly server: Server;
  readonly storage: SqliteStorage;
  readonly ptyHub: PtyHub;
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

const DAEMON_VERSION = '0.2.0';
const DATABASE_FILE = '__storage__.sqlite';

function logShareAudit(principal: AuthPrincipal, action: string, detail?: string): void {
  if (principal.kind !== 'share') return;
  const suffix = detail ? ` ${detail}` : '';
  console.log(
    `[vps-audit] shareId=${principal.share.id} role=${principal.share.role} workspaceId=${principal.share.workspaceId} action=${action}${suffix}`,
  );
}

let cachedTailscale: { value: string | null; checkedAt: number } | null = null;

async function detectTailscaleUrl(): Promise<string | null> {
  const now = Date.now();
  if (cachedTailscale && now - cachedTailscale.checkedAt < 60_000) {
    return cachedTailscale.value;
  }
  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], { timeout: 1_500 });
    const parsed = JSON.parse(stdout) as { Self?: { DNSName?: string; Online?: boolean } };
    const dnsName = parsed.Self?.DNSName?.trim().replace(/\.$/, '');
    const url = dnsName ? `https://${dnsName}` : null;
    cachedTailscale = { value: url, checkedAt: now };
    return url;
  } catch {
    cachedTailscale = { value: null, checkedAt: now };
    return null;
  }
}

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
  const bundleHash =
    options.bundleHash?.trim() ||
    process.env.PULSE_VPS_BUNDLE_HASH?.trim() ||
    (await readFile(join(process.cwd(), 'bundle.sha'), 'utf8').catch(() => '')).trim() ||
    undefined;

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
  const broadcaster = new ChangeBroadcaster(storage, options.pollIntervalMs ?? 1_500);
  await broadcaster.start();
  const ptyHub = new PtyHub(workDir, options.ptySpawner, dataDir);
  const capabilityRelay = new CapabilityRelay();
  const presenceHub = new PresenceHub();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        version: DAEMON_VERSION,
        ...(bundleHash ? { bundleHash } : {}),
      });
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
      const tailscaleUrl = principal.kind === 'admin' ? await detectTailscaleUrl() : null;
      const metaWorkspaceId =
        principal.kind === 'share'
          ? principal.share.workspaceId
          : url.searchParams.get('workspaceId')?.trim() || undefined;
      sendJson(res, 200, {
        ok: true,
        generation: storage.generation,
        version: DAEMON_VERSION,
        ...(bundleHash ? { bundleHash } : {}),
        ...(tailscaleUrl ? { tailscaleUrl } : {}),
        onlineClients: broadcaster.countSubscribers(metaWorkspaceId),
        role: principal.kind === 'admin' ? 'admin' : principal.share.role,
        ...(principal.kind === 'share' ? { workspaceId: principal.share.workspaceId } : {}),
        ...(principal.kind === 'share' && principal.share.label ? { shareLabel: principal.share.label } : {}),
        capabilities: [
          'storage-rpc',
          'workspace-files',
          'sse-events',
          'pty',
          'exec-jsonl',
          'fs-list-dirs',
          'shares',
          'tools-exec',
          'tools-exec-stream',
          'capability-relay',
          'presence',
        ],
      });
      return;
    }

    if (url.pathname === '/v1/presence' || url.pathname.startsWith('/v1/presence/')) {
      const tokenWs = principal.kind === 'share' ? principal.share.workspaceId : '';
      const queryWs = url.searchParams.get('workspaceId')?.trim() || '';
      if (req.method === 'GET' && url.pathname === '/v1/presence') {
        const wsId = tokenWs || queryWs;
        if (!isSafeWorkspaceId(wsId) || (tokenWs && queryWs && queryWs !== tokenWs)) {
          sendJson(res, 400, { ok: false, code: 'invalid_argument', message: 'valid workspaceId is required' });
          return;
        }
        sendJson(res, 200, { ok: true, peers: presenceHub.list(wsId) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/presence') {
        try {
          const body = await readJsonBody<{
            workspaceId?: string;
            clientId?: string;
            name?: string;
            activeNodeId?: string | null;
            viewport?: PresenceViewport | null;
            chatStream?: { conversationId?: string; text?: string } | null;
          }>(req);
          const bodyWs = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '';
          const wsId = tokenWs || bodyWs;
          const clientId = typeof body.clientId === 'string' ? body.clientId.trim().slice(0, 64) : '';
          if (!isSafeWorkspaceId(wsId) || (tokenWs && bodyWs && bodyWs !== tokenWs) || !clientId) {
            sendJson(res, 400, { ok: false, code: 'invalid_argument', message: 'valid workspaceId and clientId are required' });
            return;
          }
          const rawName = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : '';
          const fallbackName = principal.kind === 'share' ? principal.share.label || 'Guest' : 'Owner';
          const activeNodeId = typeof body.activeNodeId === 'string' && body.activeNodeId.trim()
            ? body.activeNodeId.trim().slice(0, 128)
            : undefined;
          const vp = body.viewport;
          const viewport =
            vp && typeof vp.x === 'number' && typeof vp.y === 'number' && typeof vp.scale === 'number'
              && Number.isFinite(vp.x) && Number.isFinite(vp.y) && Number.isFinite(vp.scale)
              ? { x: vp.x, y: vp.y, scale: vp.scale }
              : undefined;
          const cs = body.chatStream;
          const chatStream =
            cs && typeof cs.conversationId === 'string' && cs.conversationId.trim() && typeof cs.text === 'string'
              ? { conversationId: cs.conversationId.trim().slice(0, 128), text: cs.text.slice(0, 4000) }
              : undefined;
          const peers = presenceHub.upsert(wsId, {
            clientId,
            name: rawName || fallbackName,
            role: principal.kind === 'admin' ? 'admin' : principal.share.role,
            activeNodeId,
            viewport,
            chatStream,
          });
          sendJson(res, 200, { ok: true, peers });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/v1/presence/')) {
        const wsId = tokenWs || queryWs;
        const clientId = decodeURIComponent(url.pathname.slice('/v1/presence/'.length)).trim();
        if (!isSafeWorkspaceId(wsId) || (tokenWs && queryWs && queryWs !== tokenWs) || !clientId) {
          sendJson(res, 400, { ok: false, code: 'invalid_argument', message: 'valid workspaceId and clientId are required' });
          return;
        }
        presenceHub.remove(wsId, clientId);
        sendJson(res, 200, { ok: true });
        return;
      }
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
          if (!isSafeWorkspaceId(body.workspaceId) || !isValidShareRole(body.role)) {
            sendJson(res, 400, { ok: false, code: 'invalid_argument', message: 'valid workspaceId and role are required' });
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
        const rawDir = url.searchParams.get('cwd')?.trim() || url.searchParams.get('workDir')?.trim() || '';
        const dir = resolve(rawDir || workDir);
        if (principal.kind === 'share' && !isPathWithin(workDir, dir)) {
          sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Share token cannot read workspace doc outside workDir' });
          return;
        }
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
          if (principal.kind === 'share' && !isPathWithin(workDir, dir)) {
            sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Share token cannot write workspace doc outside workDir' });
            return;
          }
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
      logShareAudit(principal, 'exec-jsonl');
      await handleExecJsonl(req, res, workDir);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/tools/exec') {
      logShareAudit(principal, 'tools-exec');
      await handleToolExecRequest(req, res, principal, readJsonBody, sendJson);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/runtime/relay/events') {
      if (!canUseRuntime(principal)) {
        sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Collaborator or admin role required for capability relay' });
        return;
      }
      const requestedWorkspaceId = url.searchParams.get('workspaceId')?.trim() || '';
      const tokenWorkspaceId = principal.kind === 'share' ? principal.share.workspaceId : '';
      const scopedWorkspaceId = tokenWorkspaceId || requestedWorkspaceId;
      if (!scopedWorkspaceId || (tokenWorkspaceId && requestedWorkspaceId && requestedWorkspaceId !== tokenWorkspaceId)) {
        sendJson(res, 400, { ok: false, code: 'invalid_request', message: 'workspaceId is required and must match token scope' });
        return;
      }
      capabilityRelay.subscribe(req, res, scopedWorkspaceId);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/runtime/relay/respond') {
      if (!canUseRuntime(principal)) {
        sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Collaborator or admin role required for capability relay' });
        return;
      }
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const id = typeof body.id === 'string' ? body.id : '';
      const payload: RelayResponsePayload = {
        ok: body.ok === true,
        ...(body.value !== undefined ? { value: body.value } : {}),
        ...(body.error && typeof body.error === 'object' ? { error: body.error as RelayResponsePayload['error'] } : {}),
      };
      capabilityRelay.respond(id, payload);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/runtime/capabilities/list') {
      if (principal.kind !== 'admin') {
        sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'Admin token required' } });
        return;
      }
      const body = (await readJsonBody(req).catch(() => ({}))) as Record<string, unknown>;
      const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined;
      const result = await capabilityRelay.listCapabilities(workspaceId);
      sendJson(res, result.ok ? 200 : 503, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/runtime/capabilities/call') {
      if (principal.kind !== 'admin') {
        sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'Admin token required' } });
        return;
      }
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const result = await capabilityRelay.callCapability({
        workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : '',
        name: typeof body.name === 'string' ? body.name : '',
        input: body.input,
      });
      sendJson(res, 200, result);
      return;
    }

    if (url.pathname.startsWith('/v1/pty/')) {
      if (!canUseRuntime(principal)) {
        sendJson(res, 403, { ok: false, code: 'forbidden', message: 'Collaborator or admin role required to access remote terminals' });
        return;
      }
      if (req.method !== 'GET' && (url.pathname.endsWith('/spawn') || url.pathname.endsWith('/kill'))) {
        logShareAudit(principal, 'pty', `${req.method} ${url.pathname}`);
      }
      if (await ptyHub.handleHttp(req, res, url, principal)) {
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
  const runtimeFile = join(homedir(), '.pulse-coder', 'canvas-runtime', 'canvas-workspace.json');

  if (options.writeRuntimeDescriptor) {
    try {
      await mkdir(dirname(runtimeFile), { recursive: true });
      const runtimeHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
      await writeFile(
        runtimeFile,
        JSON.stringify(
          {
            pid: process.pid,
            baseUrl: `http://${runtimeHost}:${boundPort}/v1/runtime`,
            secret: options.token,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        { encoding: 'utf8', mode: 0o600 },
      );
    } catch {
      // Non-fatal: storage and terminal endpoints remain usable even if runtime file cannot be written.
    }
  }

  return {
    server,
    storage,
    ptyHub,
    url: boundUrl,
    port: boundPort,
    async close() {
      broadcaster.stop();
      capabilityRelay.closeAll();
      ptyHub.closeAll();
      if (options.writeRuntimeDescriptor) {
        try {
          const raw = await readFile(runtimeFile, 'utf8');
          const parsed = JSON.parse(raw) as { pid?: number };
          if (parsed.pid === process.pid) {
            await unlink(runtimeFile);
          }
        } catch {
          // Ignore missing or already-replaced runtime descriptor.
        }
      }
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await storage.close();
    },
  };
}
