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
