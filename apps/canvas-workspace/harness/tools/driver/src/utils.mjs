import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { HarnessError } from './errors.mjs';

const execFileAsync = promisify(execFile);

export function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitFor(fn, timeoutMs) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw lastError ?? new Error(`Timed out after ${timeoutMs}ms`);
}

export async function getFreePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.listen(0, '127.0.0.1', resolveListen);
    server.once('error', rejectListen);
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : undefined;
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!port) throw new HarnessError('Could not allocate a local CDP port.');
  return port;
}

export async function tailFile(file, lines) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw.split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export async function execFileText(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, {
    timeout: options.timeoutMs ?? 10_000,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
  });
  return stdout.trim();
}
