import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir, platform } from 'node:os';
import { readlink } from 'node:fs/promises';
import { readJsonBody, sendJson } from './auth.js';

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
  proc: ManagedPtyProcess;
  scrollback: string;
  subscribers: Set<ServerResponse>;
  exited: boolean;
  exitCode?: number;
}

const MAX_SCROLLBACK_CHARS = 128 * 1024;

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
  const proc = pty.spawn(options.shell, [], {
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
 * Client SSE disconnects only detach the listener; the underlying shell/agent
 * process keeps running and retains a bounded scrollback buffer for reattach.
 */
export class PtyHub {
  private readonly sessions = new Map<string, PtySessionRecord>();
  private readonly spawner: PtySpawner;

  constructor(
    private readonly defaultCwd: string = homedir(),
    spawner?: PtySpawner,
  ) {
    this.spawner = spawner ?? defaultPtySpawner;
  }

  async spawnOrReuse(payload: {
    id: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
  }): Promise<{ ok: true; pid: number; reused: boolean } | { ok: false; error: string }> {
    const id = payload.id?.trim();
    if (!id) return { ok: false, error: 'Missing PTY session id' };

    const existing = this.sessions.get(id);
    if (existing && !existing.exited) {
      if (payload.cols && payload.rows) {
        try {
          existing.proc.resize(payload.cols, payload.rows);
        } catch {
          /* ignore */
        }
      }
      return { ok: true, pid: existing.proc.pid, reused: true };
    }

    const cwd = payload.cwd && existsSync(payload.cwd) ? payload.cwd : this.defaultCwd;
    const baseEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') baseEnv[k] = v;
    }
    if (payload.env) {
      for (const [k, v] of Object.entries(payload.env)) {
        if (typeof v === 'string') baseEnv[k] = v;
      }
    }
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
        proc,
        scrollback: '',
        subscribers: new Set(),
        exited: false,
      };
      this.sessions.set(id, record);

      proc.onData((data) => {
        record.scrollback += data;
        if (record.scrollback.length > MAX_SCROLLBACK_CHARS) {
          record.scrollback = record.scrollback.slice(-MAX_SCROLLBACK_CHARS);
        }
        const frame = `event: data\ndata: ${JSON.stringify({ data })}\n\n`;
        for (const sub of record.subscribers) {
          try {
            sub.write(frame);
          } catch {
            record.subscribers.delete(sub);
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
    if (includeScrollback && record.scrollback.length > 0) {
      res.write(`event: data\ndata: ${JSON.stringify({ data: record.scrollback })}\n\n`);
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
    this.sessions.delete(id);
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

  async handleHttp(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/v1/runtime/check-command') {
      const command = url.searchParams.get('command') ?? '';
      sendJson(res, 200, await this.checkCommand(command));
      return true;
    }

    if (req.method === 'POST' && pathname === '/v1/pty/spawn') {
      const body = await readJsonBody<{
        id: string;
        cols?: number;
        rows?: number;
        cwd?: string;
        env?: Record<string, string | undefined>;
      }>(req);
      const result = await this.spawnOrReuse(body);
      sendJson(res, result.ok ? 200 : 400, result);
      return true;
    }

    const ptyMatch = /^\/v1\/pty\/([^/]+)\/(stream|write|resize|kill|cwd|scrollback)$/.exec(
      pathname,
    );
    if (!ptyMatch) return false;

    const sessionId = decodeURIComponent(ptyMatch[1]);
    const action = ptyMatch[2];

    if (req.method === 'GET' && action === 'stream') {
      const includeScrollback = url.searchParams.get('scrollback') !== '0';
      this.attachStream(sessionId, req, res, includeScrollback);
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
