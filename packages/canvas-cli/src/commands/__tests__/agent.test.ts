import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { createServer, type Server } from 'http';
import { createCli } from '../../cli';

// All tests in this file write to ~/.pulse-coder/canvas-runtime/canvas-workspace.json
// since the CLI hard-codes that path. We back up any real file before each
// test and restore it afterwards so we don't clobber the user's live runtime.
const RUNTIME_FILE = join(homedir(), '.pulse-coder', 'canvas-runtime', 'canvas-workspace.json');
let backup: Buffer | null = null;

beforeEach(async () => {
  try {
    backup = await fs.readFile(RUNTIME_FILE);
  } catch {
    backup = null;
  }
  await fs.rm(RUNTIME_FILE, { force: true });
});

afterEach(async () => {
  if (backup) {
    await fs.mkdir(join(homedir(), '.pulse-coder', 'canvas-runtime'), { recursive: true });
    await fs.writeFile(RUNTIME_FILE, backup);
  } else {
    await fs.rm(RUNTIME_FILE, { force: true });
  }
});

async function writeRuntime(info: object): Promise<void> {
  await fs.mkdir(join(homedir(), '.pulse-coder', 'canvas-runtime'), { recursive: true });
  await fs.writeFile(RUNTIME_FILE, JSON.stringify(info));
}

function startStubServer(
  handler: (body: unknown, headers: Record<string, string | string[] | undefined>) =>
    { status: number; body: unknown },
): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        } catch {}
        const { status, body } = handler(parsed, req.headers);
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr !== 'object') throw new Error('listen failed');
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function runCli(argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    stdout.push(args.map(String).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    stderr.push(args.map(String).join(' '));
  });
  let exitCode: number | null = null;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`__exit:${code}`);
  }) as never);

  const cli = createCli();
  cli.exitOverride();
  try {
    await cli.parseAsync(argv, { from: 'user' });
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('__exit:')) {
      // commander errors hit here too — treat as exit
    }
  }
  logSpy.mockRestore();
  errSpy.mockRestore();
  exitSpy.mockRestore();
  return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode };
}

describe('pulse-canvas agent send', () => {
  it('fails when runtime file is missing', async () => {
    const { stderr, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'agent', 'send', 'node-1', '--input', 'hi',
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/No active canvas-workspace runtime found/);
  });

  it('fails when runtime file is corrupt', async () => {
    await writeRuntime({} as unknown as object);
    const { stderr, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'agent', 'send', 'node-1', '--input', 'hi',
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/missing baseUrl or secret|corrupt/);
  });

  it('reports 401 with a clear hint', async () => {
    const { server, baseUrl } = await startStubServer(() => ({
      status: 401, body: { ok: false, error: 'unauthorized' },
    }));
    await writeRuntime({ pid: process.pid, baseUrl, secret: 'wrong', createdAt: '' });
    const { stderr, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'agent', 'send', 'node-1', '--input', 'hi',
    ]);
    server.close();
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Runtime authentication failed/);
  });

  it('reports connection failure clearly', async () => {
    await writeRuntime({ pid: process.pid, baseUrl: 'http://127.0.0.1:1', secret: 's', createdAt: '' });
    const { stderr, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'agent', 'send', 'node-1', '--input', 'hi',
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Cannot reach canvas-workspace runtime/);
  });

  it('happy path: posts to /agent/send with bearer auth and prints OK', async () => {
    let seenAuth = '';
    let seenBody: unknown = null;
    const { server, baseUrl } = await startStubServer((body, headers) => {
      seenAuth = String(headers['authorization'] ?? '');
      seenBody = body;
      return { status: 200, body: { ok: true, nodeId: 'node-1', bytesSent: 3 } };
    });
    await writeRuntime({ pid: process.pid, baseUrl, secret: 'tok', createdAt: '' });
    const { stdout, exitCode } = await runCli([
      '--workspace', 'ws-x',
      'agent', 'send', 'node-1', '--input', 'hi',
    ]);
    server.close();

    expect(exitCode).toBe(null);
    expect(seenAuth).toBe('Bearer tok');
    expect(seenBody).toEqual({ workspaceId: 'ws-x', nodeId: 'node-1', input: 'hi' });
    expect(stdout).toMatch(/OK \(sent 3 bytes to node-1\)/);
  });
});
