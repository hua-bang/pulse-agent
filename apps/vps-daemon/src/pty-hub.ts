import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir, platform } from 'node:os';
import { readlink } from 'node:fs/promises';
import type { Duplex } from 'node:stream';
import { readJsonBody, sendJson, writeSseFrame } from './auth.js';
import type { AuthPrincipal } from './shares.js';
import { acceptWebSocket, rejectUpgrade, type WsConnection } from './ws-frame.js';

function expandHome(dir: string): string {
  if (dir === '~') return homedir();
  if (dir.startsWith('~/')) return `${homedir()}/${dir.slice(2)}`;
  return dir;
}

/**
 * Pick the first candidate that exists on this host. Clients may send a
 * desktop-local folder (for example a macOS path) that does not exist on the
 * VPS, so the configured VPS folder is tried before the daemon default.
 */
export function resolveSpawnCwd(candidates: Array<string | undefined>, defaultCwd: string): string {
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const dir = expandHome(trimmed);
    if (existsSync(dir)) return dir;
  }
  return defaultCwd;
}

export interface ManagedPtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): { dispose(): void } | void;
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void } | void;
}

export type PtySpawner = (options: {
  shell: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}) => Promise<ManagedPtyProcess>;

interface PtySessionRecord {
  id: string;
  workspaceId?: string;
  proc: ManagedPtyProcess;
  scrollback: string;
  subscribers: Set<ServerResponse>;
  wsSubscribers: Set<WsConnection>;
  exited: boolean;
  exitCode?: number;
  /** Total characters ever emitted; stream frames carry it as `offset`. */
  outputChars: number;
}

const MAX_SCROLLBACK_CHARS = 128 * 1024;

/**
 * Output a client missed since `since`. If the gap is larger than the retained
 * scrollback, the whole scrollback is replayed (the oldest part is gone).
 */
export function missedOutput(record: { scrollback: string; outputChars: number }, since: number): string {
  const missed = record.outputChars - since;
  if (missed <= 0) return '';
  return missed >= record.scrollback.length ? record.scrollback : record.scrollback.slice(-missed);
}

function pickShell(): string {
  if (platform() === 'win32') return 'powershell.exe';
  for (const candidate of [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/usr/bin/bash',
    '/bin/sh',
  ]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return '/bin/sh';
}

async function defaultPtySpawner(options: {
  shell: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}): Promise<ManagedPtyProcess> {
  const pty = await import('node-pty');
  const shellArgs = /(?:^|\/)(?:bash|zsh|sh)$/.test(options.shell) ? ['-l'] : [];
  const proc = pty.spawn(options.shell, shellArgs, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env,
  });
  return {
    pid: proc.pid,
    write: (data: string) => proc.write(data),
    resize: (cols: number, rows: number) => proc.resize(cols, rows),
    kill: () => proc.kill(),
    onData: (listener) => proc.onData(listener),
    onExit: (listener) => proc.onExit(listener),
  };
}

/**
 * Persistent PTY hub on the VPS.
 * Client disconnects only detach the listener; the underlying shell/agent
 * process keeps running and retains a bounded scrollback buffer for reattach.
 */
export class PtyHub {
  private readonly sessions = new Map<string, PtySessionRecord>();
  private readonly spawner: PtySpawner;

  constructor(
    private readonly defaultCwd: string = homedir(),
    spawner?: PtySpawner,
    private readonly dataDir?: string,
  ) {
    this.spawner = spawner ?? defaultPtySpawner;
  }

  private canAccessSession(id: string, principal: AuthPrincipal): boolean {
    if (principal.kind === 'admin') return true;
    const existing = this.sessions.get(id);
    if (!existing) return true;
    return existing.workspaceId === principal.share.workspaceId;
  }

  async spawnOrReuse(
    payload: {
      id: string;
      workspaceId?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      /** Used when `cwd` does not exist on this host (e.g. a desktop-local path). */
      fallbackCwd?: string;
      env?: Record<string, string | undefined>;
    },
    principal: AuthPrincipal = { kind: 'admin' },
  ): Promise<
    | { ok: true; pid: number; reused: boolean }
    | { ok: false; error: string; forbidden?: boolean }
  > {
    const id = payload.id?.trim();
    if (!id) return { ok: false, error: 'Missing PTY session id' };

    const requestedWs = payload.workspaceId?.trim() || undefined;
    if (principal.kind === 'share' && requestedWs && requestedWs !== principal.share.workspaceId) {
      return {
        ok: false,
        forbidden: true,
        error: 'Share token cannot spawn PTY for another workspace',
      };
    }
    const effectiveWorkspaceId =
      principal.kind === 'share' ? principal.share.workspaceId : requestedWs;

    const existing = this.sessions.get(id);
    if (existing && !existing.exited) {
      if (principal.kind === 'share' && existing.workspaceId !== principal.share.workspaceId) {
        return {
          ok: false,
          forbidden: true,
          error: 'Share token cannot access PTY session outside its workspace',
        };
      }
      if (payload.cols && payload.rows) {
        try {
          existing.proc.resize(payload.cols, payload.rows);
        } catch {
          /* ignore */
        }
      }
      return { ok: true, pid: existing.proc.pid, reused: true };
    }

    const cwd = resolveSpawnCwd([payload.cwd, payload.fallbackCwd], this.defaultCwd);
    const baseEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') baseEnv[k] = v;
    }
    if (payload.env) {
      for (const [k, v] of Object.entries(payload.env)) {
        if (typeof v === 'string') baseEnv[k] = v;
      }
    }
    const vpsBinDir = `${homedir()}/.pulse-vps-daemon/bin`;
    if (existsSync(vpsBinDir)) {
      baseEnv.PATH = baseEnv.PATH ? `${vpsBinDir}:${baseEnv.PATH}` : vpsBinDir;
    }
    if (this.dataDir && !baseEnv.PULSE_CANVAS_DATA_DIR) {
      baseEnv.PULSE_CANVAS_DATA_DIR = this.dataDir;
    }
    baseEnv.TERM = 'xterm-256color';
    baseEnv.COLORTERM = 'truecolor';
    if (!baseEnv.LANG) baseEnv.LANG = 'en_US.UTF-8';

    try {
      const proc = await this.spawner({
        shell: pickShell(),
        cols: payload.cols ?? 120,
        rows: payload.rows ?? 32,
        cwd,
        env: baseEnv,
      });
      const record: PtySessionRecord = {
        id,
        ...(effectiveWorkspaceId ? { workspaceId: effectiveWorkspaceId } : {}),
        proc,
        scrollback: '',
        subscribers: new Set(),
        wsSubscribers: new Set(),
        exited: false,
        outputChars: 0,
      };
      this.sessions.set(id, record);

      proc.onData((data) => {
        record.scrollback += data;
        record.outputChars += data.length;
        if (record.scrollback.length > MAX_SCROLLBACK_CHARS) {
          record.scrollback = record.scrollback.slice(-MAX_SCROLLBACK_CHARS);
        }
        if (record.subscribers.size > 0) {
          const frame = `event: data\ndata: ${JSON.stringify({ data, offset: record.outputChars })}\n\n`;
          for (const sub of record.subscribers) {
            // A dropped stalled reader reconnects with `since` and catches up.
            if (!writeSseFrame(sub, frame)) record.subscribers.delete(sub);
          }
        }
        if (record.wsSubscribers.size > 0) {
          const wsFrame = JSON.stringify({ type: 'data', data, offset: record.outputChars });
          for (const ws of record.wsSubscribers) {
            try {
              ws.sendText(wsFrame);
            } catch {
              record.wsSubscribers.delete(ws);
            }
          }
        }
      });

      proc.onExit(({ exitCode }) => {
        record.exited = true;
        record.exitCode = exitCode;
        const frame = `event: exit\ndata: ${JSON.stringify({ exitCode })}\n\n`;
        for (const sub of record.subscribers) {
          try {
            sub.write(frame);
            sub.end();
          } catch {
            /* ignore */
          }
        }
        record.subscribers.clear();
        const wsFrame = JSON.stringify({ type: 'exit', exitCode });
        for (const ws of record.wsSubscribers) {
          try {
            ws.sendText(wsFrame);
            ws.close(1000);
          } catch {
            /* ignore */
          }
        }
        record.wsSubscribers.clear();
        this.sessions.delete(id);
      });

      return { ok: true, pid: proc.pid, reused: false };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  attachStream(
    id: string,
    req: IncomingMessage,
    res: ServerResponse,
    includeScrollback = true,
    since?: number,
  ): void {
    const record = this.sessions.get(id);
    if (!record) {
      sendJson(res, 404, { ok: false, error: `PTY session not found: ${id}` });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const replay = since === undefined
      ? (includeScrollback ? record.scrollback : '')
      : missedOutput(record, since);
    if (replay.length > 0 || since !== undefined) {
      res.write(`event: data\ndata: ${JSON.stringify({ data: replay, offset: record.outputChars })}\n\n`);
    }
    if (record.exited) {
      res.write(`event: exit\ndata: ${JSON.stringify({ exitCode: record.exitCode ?? 0 })}\n\n`);
      res.end();
      return;
    }
    record.subscribers.add(res);
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
      record.subscribers.delete(res);
    });
  }

  write(id: string, data: string): boolean {
    const record = this.sessions.get(id);
    if (!record || record.exited) return false;
    record.proc.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const record = this.sessions.get(id);
    if (!record || record.exited) return false;
    try {
      record.proc.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  kill(id: string): boolean {
    const record = this.sessions.get(id);
    if (!record) return false;
    try {
      record.proc.kill();
    } catch {
      /* ignore */
    }
    for (const ws of record.wsSubscribers) {
      try {
        ws.close(1000);
      } catch {
        /* ignore */
      }
    }
    record.wsSubscribers.clear();
    this.sessions.delete(id);
    return true;
  }

  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    url: URL,
    principal: AuthPrincipal = { kind: 'admin' },
  ): boolean {
    const match = /^\/v1\/pty\/([^/]+)\/ws$/.exec(url.pathname);
    if (!match) return false;
    const sessionId = decodeURIComponent(match[1]);
    if (!this.canAccessSession(sessionId, principal)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return true;
    }
    const record = this.sessions.get(sessionId);
    if (!record) {
      rejectUpgrade(socket, 404, 'PTY session not found');
      return true;
    }
    const ws = acceptWebSocket(req, socket, head);
    if (!ws) return true;

    const includeScrollback = url.searchParams.get('scrollback') !== '0';
    const sinceRaw = url.searchParams.get('since');
    const since = sinceRaw !== null && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : undefined;
    const replay = since === undefined
      ? (includeScrollback ? record.scrollback : '')
      : missedOutput(record, since);
    if (replay.length > 0 || since !== undefined) {
      ws.sendText(JSON.stringify({ type: 'data', data: replay, offset: record.outputChars }));
    }
    if (record.exited) {
      ws.sendText(JSON.stringify({ type: 'exit', exitCode: record.exitCode ?? 0 }));
      ws.close(1000);
      return true;
    }
    record.wsSubscribers.add(ws);
    const canWrite = principal.kind === 'admin' || principal.share.role === 'collaborator';
    ws.onMessage((text) => {
      if (!canWrite) return;
      try {
        const msg = JSON.parse(text) as { type?: string; data?: string; cols?: number; rows?: number };
        if (msg.type === 'input' && typeof msg.data === 'string') {
          this.write(sessionId, msg.data);
        } else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          this.resize(sessionId, msg.cols, msg.rows);
        }
      } catch {
        // Ignore malformed control frames.
      }
    });
    ws.onClose(() => {
      record.wsSubscribers.delete(ws);
    });
    return true;
  }

  getScrollback(id: string, maxChars = MAX_SCROLLBACK_CHARS): string | null {
    const record = this.sessions.get(id);
    if (!record) return null;
    return record.scrollback.slice(-maxChars);
  }

  async getCwd(id: string): Promise<string | null> {
    const record = this.sessions.get(id);
    if (!record || record.exited) return null;
    if (platform() === 'linux') {
      try {
        return await readlink(`/proc/${record.proc.pid}/cwd`);
      } catch {
        return null;
      }
    }
    return null;
  }

  checkCommand(command: string): Promise<{ ok: true; available: boolean; path?: string }> {
    const cleaned = command.trim();
    if (!cleaned || /[\s;&|<>`$()]/.test(cleaned)) {
      return Promise.resolve({ ok: true, available: false });
    }
    const finder = platform() === 'win32' ? 'where' : 'which';
    return new Promise((resolve) => {
      execFile(finder, [cleaned], { timeout: 3_000 }, (err, stdout) => {
        const found = stdout?.trim().split('\n')[0]?.trim();
        if (err || !found) resolve({ ok: true, available: false });
        else resolve({ ok: true, available: true, path: found });
      });
    });
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.kill(id);
    }
  }

  async handleHttp(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    principal: AuthPrincipal = { kind: 'admin' },
  ): Promise<boolean> {
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/v1/runtime/check-command') {
      const command = url.searchParams.get('command') ?? '';
      sendJson(res, 200, await this.checkCommand(command));
      return true;
    }

    if (req.method === 'POST' && pathname === '/v1/pty/spawn') {
      const body = await readJsonBody<{
        id: string;
        workspaceId?: string;
        cols?: number;
        rows?: number;
        cwd?: string;
        fallbackCwd?: string;
        env?: Record<string, string | undefined>;
      }>(req);
      const result = await this.spawnOrReuse(body, principal);
      const status = result.ok ? 200 : result.forbidden ? 403 : 400;
      sendJson(res, status, result);
      return true;
    }

    const ptyMatch = /^\/v1\/pty\/([^/]+)\/(stream|write|resize|kill|cwd|scrollback)$/.exec(
      pathname,
    );
    if (!ptyMatch) return false;

    const sessionId = decodeURIComponent(ptyMatch[1]);
    const action = ptyMatch[2];

    if (!this.canAccessSession(sessionId, principal)) {
      sendJson(res, 403, {
        ok: false,
        code: 'forbidden',
        error: 'Share token cannot access PTY session outside its workspace',
      });
      return true;
    }

    if (req.method === 'GET' && action === 'stream') {
      const includeScrollback = url.searchParams.get('scrollback') !== '0';
      const sinceRaw = url.searchParams.get('since');
      const since = sinceRaw !== null && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : undefined;
      this.attachStream(sessionId, req, res, includeScrollback, since);
      return true;
    }
    if (req.method === 'POST' && action === 'write') {
      const body = await readJsonBody<{ data?: string }>(req);
      const ok = typeof body.data === 'string' && this.write(sessionId, body.data);
      sendJson(res, ok ? 200 : 404, { ok });
      return true;
    }
    if (req.method === 'POST' && action === 'resize') {
      const body = await readJsonBody<{ cols?: number; rows?: number }>(req);
      const ok =
        typeof body.cols === 'number' &&
        typeof body.rows === 'number' &&
        this.resize(sessionId, body.cols, body.rows);
      sendJson(res, ok ? 200 : 404, { ok });
      return true;
    }
    if (req.method === 'POST' && action === 'kill') {
      sendJson(res, 200, { ok: this.kill(sessionId) });
      return true;
    }
    if (req.method === 'GET' && action === 'cwd') {
      const cwd = await this.getCwd(sessionId);
      sendJson(res, 200, { ok: true, cwd });
      return true;
    }
    if (req.method === 'GET' && action === 'scrollback') {
      const maxChars = Number(url.searchParams.get('maxChars') ?? MAX_SCROLLBACK_CHARS);
      const text = this.getScrollback(
        sessionId,
        Number.isFinite(maxChars) ? maxChars : MAX_SCROLLBACK_CHARS,
      );
      if (text === null) sendJson(res, 404, { ok: false, error: 'PTY session not found' });
      else sendJson(res, 200, { ok: true, text });
      return true;
    }

    return false;
  }
}
