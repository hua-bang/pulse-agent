import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

interface ActiveTunnel {
  key: string;
  localPort: number;
  endpoint: string;
  child: ChildProcess;
}

const activeTunnels = new Map<string, Promise<ActiveTunnel>>();

async function allocateFreeLocalPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHealth(
  endpoint: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  let exitDetail = '';
  child.once('exit', (code, signal) => {
    exited = true;
    exitDetail = `code=${code ?? 'null'} signal=${signal ?? 'null'}`;
  });

  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`SSH tunnel exited before becoming ready (${exitDetail})`);
    }
    try {
      const res = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) return;
    } catch {
      // Keep polling until the forwarded port accepts HTTP.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for SSH tunnel at ${endpoint} after ${timeoutMs}ms`);
}

/**
 * Ensure a local SSH port-forwarding tunnel (`127.0.0.1:<localPort> -> 127.0.0.1:<remotePort>`)
 * is running for the given VPS host. Reuses an existing healthy tunnel for the same target.
 */
export async function ensureSshTunnel(options: {
  sshHost: string;
  sshPort?: number;
  remotePort?: number;
  timeoutMs?: number;
}): Promise<string> {
  const remotePort = options.remotePort ?? 4770;
  const sshPort = options.sshPort ?? 22;
  const key = `${options.sshHost}:${sshPort}->${remotePort}`;

  const existing = activeTunnels.get(key);
  if (existing) {
    const tunnel = await existing;
    if (tunnel.child.exitCode === null && !tunnel.child.killed) {
      return tunnel.endpoint;
    }
    activeTunnels.delete(key);
  }

  const pending = (async (): Promise<ActiveTunnel> => {
    const localPort = await allocateFreeLocalPort();
    const endpoint = `http://127.0.0.1:${localPort}`;
    const args = [
      '-N',
      '-o',
      'BatchMode=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
      '-p',
      String(sshPort),
      '-L',
      `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
      options.sshHost,
    ];
    const child = spawn('ssh', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    child.unref();

    const stderrChunks: string[] = [];
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderrChunks.push(chunk);
      if (stderrChunks.length > 10) stderrChunks.shift();
    });

    child.once('exit', () => {
      if (activeTunnels.get(key) === pending) {
        activeTunnels.delete(key);
      }
    });

    try {
      await waitForHealth(endpoint, child, options.timeoutMs ?? 10_000);
      return { key, localPort, endpoint, child };
    } catch (error) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      const detail = stderrChunks.join('').trim();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(detail ? `${message}: ${detail}` : message);
    }
  })();

  activeTunnels.set(key, pending);
  try {
    return (await pending).endpoint;
  } catch (error) {
    activeTunnels.delete(key);
    throw error;
  }
}

export async function closeAllSshTunnels(): Promise<void> {
  const entries = [...activeTunnels.values()];
  activeTunnels.clear();
  for (const settled of await Promise.allSettled(entries)) {
    if (settled.status === 'fulfilled') {
      try {
        settled.value.child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }
}
