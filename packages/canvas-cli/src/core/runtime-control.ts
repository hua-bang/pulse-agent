import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { errorOutput } from '../output';

const RUNTIME_FILE = join(homedir(), '.pulse-coder', 'canvas-runtime', 'canvas-workspace.json');

export interface RuntimeInfo {
  pid: number;
  baseUrl: string;
  secret: string;
  createdAt: string;
}

export async function readRuntime(): Promise<RuntimeInfo> {
  let raw: string;
  try {
    raw = await fs.readFile(RUNTIME_FILE, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      errorOutput(
        'No active canvas-workspace runtime found.\n' +
        'Open this workspace in Pulse Canvas before using live agent/team commands.',
        { code: 'runtime_not_found' },
      );
    }
    errorOutput(`Cannot read runtime file (${RUNTIME_FILE}): ${String(err)}`, { code: 'runtime_unreadable' });
  }
  try {
    const info = JSON.parse(raw!) as RuntimeInfo;
    if (!info.baseUrl || !info.secret) {
      errorOutput('Runtime file is missing baseUrl or secret. Restart Pulse Canvas.', { code: 'runtime_invalid' });
    }
    return info;
  } catch {
    errorOutput('Runtime file is corrupt. Restart Pulse Canvas.', { code: 'runtime_corrupt' });
  }
}

export async function postRuntime<TBody extends object, TResponse>(
  runtime: RuntimeInfo,
  path: string,
  body: TBody,
): Promise<{ status: number; body: TResponse | { ok: false; error: string; code?: string } }> {
  let res: Response;
  try {
    res = await fetch(`${runtime.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${runtime.secret}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    errorOutput(
      `Cannot reach canvas-workspace runtime at ${runtime.baseUrl}: ${(err as Error).message}\n` +
      'The Electron app may not be running, or the runtime file is stale.',
      { code: 'runtime_unreachable' },
    );
  }

  try {
    return { status: res!.status, body: await res!.json() as TResponse };
  } catch {
    return {
      status: res!.status,
      body: { ok: false, error: `non-JSON response (HTTP ${res!.status})` },
    };
  }
}

export function runtimeAuthHint(): string {
  return 'Runtime authentication failed (401). The secret in the runtime file does not match the running canvas-workspace. Restart Pulse Canvas to refresh it.';
}

/** Absolute path of the runtime-control descriptor file. */
export function runtimeFilePath(): string {
  return RUNTIME_FILE;
}

export interface RuntimeStatus {
  /** The runtime descriptor file exists on disk. */
  present: boolean;
  /** A live HTTP response came back from the advertised baseUrl. */
  reachable: boolean;
  baseUrl?: string;
  pid?: number;
  /** Why it isn't present/reachable, when applicable. */
  error?: string;
}

/**
 * Non-fatal counterpart to {@link readRuntime}: report whether the Electron
 * runtime is present and reachable without exiting the process. Used by
 * `pulse-canvas status` so an external caller can decide up-front whether the
 * live `agent`/`team` commands are usable.
 */
export async function probeRuntime(): Promise<RuntimeStatus> {
  let raw: string;
  try {
    raw = await fs.readFile(RUNTIME_FILE, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      present: false,
      reachable: false,
      error: code === 'ENOENT' ? 'no runtime file (open the workspace in Pulse Canvas)' : String(err),
    };
  }

  let info: RuntimeInfo;
  try {
    info = JSON.parse(raw) as RuntimeInfo;
  } catch {
    return { present: true, reachable: false, error: 'runtime file is corrupt' };
  }
  if (!info.baseUrl || !info.secret) {
    return { present: true, reachable: false, error: 'runtime file missing baseUrl or secret' };
  }

  // Any HTTP response (even a 401/404) proves the server is up; a transport
  // error means it isn't. Bounded so `status` never hangs on a stale file.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    await fetch(info.baseUrl, {
      method: 'GET',
      headers: { authorization: `Bearer ${info.secret}` },
      signal: controller.signal,
    });
    return { present: true, reachable: true, baseUrl: info.baseUrl, pid: info.pid };
  } catch (err) {
    return {
      present: true,
      reachable: false,
      baseUrl: info.baseUrl,
      pid: info.pid,
      error: `unreachable at ${info.baseUrl}: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
