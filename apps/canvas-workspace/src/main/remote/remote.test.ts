import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getRemoteWorkspaceConfig,
  listConfiguredRemoteWorkspaceIds,
  resolveRemoteToken,
} from './config';
import {
  closeAllRemoteConnections,
  getRemoteCanvasBackend,
  getRemoteWorkspaceFiles,
  resolveRemoteWorkspaceTarget,
} from './client';
import { connectRemotePty, runRemoteJsonlCli } from './runtime-client';

describe('remote VPS workspace client', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    delete process.env.PULSE_CANVAS_REMOTE_CONFIG;
    delete process.env.TEST_VPS_TOKEN;
    await closeAllRemoteConnections();
    while (cleanups.length) {
      await cleanups.pop()?.();
    }
  });

  async function startMockDaemon(): Promise<{
    url: string;
    token: string;
    server: Server;
    writes: string[];
  }> {
    const token = 'vps-secret-999';
    const writes: string[] = [];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'unauthorized', message: 'bad token' }));
        return;
      }

      if (url.pathname === '/v1/meta') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            generation: 'gen-vps-1',
            version: '0.1.0',
            capabilities: ['pty'],
          }),
        );
        return;
      }

      if (url.pathname === '/v1/storage/rpc') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.from(c));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          method: string;
          args: unknown[];
        };
        if (body.method === 'canvas.read') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              result: {
                generation: 'gen-vps-1',
                workspaceId: body.args[0],
                revision: 3,
                metadata: { title: 'Remote Canvas' },
                nodes: [{ id: 'n1', type: 'note', title: 'From VPS' }],
                placements: [{ id: 'n1', nodeId: 'n1', x: 0, y: 0, width: 320, height: 240 }],
                edges: [],
              },
            }),
          );
          return;
        }
      }

      if (url.pathname === '/v1/files' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            uri: url.searchParams.get('uri'),
            version: 'sha256:abc',
            base64: Buffer.from('# Remote Note', 'utf8').toString('base64'),
          }),
        );
        return;
      }

      if (url.pathname === '/v1/pty/spawn') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pid: 4242, reused: false }));
        return;
      }

      if (url.pathname === '/v1/pty/term-vps/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`event: data\ndata: ${JSON.stringify({ data: 'welcome-vps\n' })}\n\n`);
        return;
      }

      if (url.pathname === '/v1/pty/term-vps/write') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.from(c));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { data: string };
        writes.push(body.data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname === '/v1/exec-jsonl') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`event: line\ndata: ${JSON.stringify({ line: '{"type":"done"}' })}\n\n`);
        res.write(`event: exit\ndata: ${JSON.stringify({ code: 0, stderrTail: '' })}\n\n`);
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    return { url: `http://127.0.0.1:${port}`, token, server, writes };
  }

  it('loads VPS config with tokenEnv and connects storage, files, PTY, and exec-jsonl', async () => {
    const mock = await startMockDaemon();
    const dir = await mkdtemp(join(tmpdir(), 'pulse-remote-cfg-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    const cfgPath = join(dir, 'remote-workspaces.json');
    process.env.PULSE_CANVAS_REMOTE_CONFIG = cfgPath;
    process.env.TEST_VPS_TOKEN = mock.token;

    await writeFile(
      cfgPath,
      JSON.stringify({
        workspaces: {
          'ws-vps': {
            kind: 'vps',
            endpoint: mock.url,
            tokenEnv: 'TEST_VPS_TOKEN',
            remoteWorkspaceId: 'ws-vps-remote',
            cwd: '/srv/app',
          },
        },
      }),
      'utf8',
    );

    const cfg = getRemoteWorkspaceConfig('ws-vps');
    expect(cfg?.endpoint).toBe(mock.url);
    expect(resolveRemoteToken(cfg!)).toBe(mock.token);
    expect(listConfiguredRemoteWorkspaceIds()).toEqual(['ws-vps']);

    const canvasBackend = await getRemoteCanvasBackend('ws-vps');
    expect(canvasBackend?.target.remoteWorkspaceId).toBe('ws-vps-remote');
    const canvas = await canvasBackend!.backend.readCanvas('ws-vps-remote');
    expect(canvas?.nodes?.[0]?.title).toBe('From VPS');

    const remoteFiles = await getRemoteWorkspaceFiles('ws-vps');
    const note = await remoteFiles!.files.readText('pulse-remote:///ws-vps-remote/note.md');
    expect(note?.content).toBe('# Remote Note');

    const target = await resolveRemoteWorkspaceTarget('ws-vps');
    const received: string[] = [];
    const ptyRes = await connectRemotePty(
      target!,
      { id: 'term-vps', cols: 80, rows: 24 },
      { onData: (d) => received.push(d), onExit: () => undefined },
    );
    expect(ptyRes.ok).toBe(true);
    if (ptyRes.ok) {
      ptyRes.handle.write('ls\n');
      await new Promise((r) => setTimeout(r, 80));
      expect(received.join('')).toContain('welcome-vps');
      expect(mock.writes).toContain('ls\n');
      ptyRes.handle.detach();
    }

    const lines: string[] = [];
    const exit = await runRemoteJsonlCli(target!, {
      command: 'claude',
      args: ['--print'],
      prompt: 'hi',
      abortSignal: new AbortController().signal,
      onLine: (line) => lines.push(line),
    });
    expect(exit.code).toBe(0);
    expect(lines).toEqual(['{"type":"done"}']);
  });

  it('supports runtime-only VPS mode for existing local workspaces and full migration via migrateLocalWorkspaceToVps', async () => {
    const { saveRemoteWorkspaceConfig, removeRemoteWorkspaceConfig } = await import('./config');
    const { migrateLocalWorkspaceToVps } = await import('./migrate');
    const { mkdir } = await import('node:fs/promises');

    const importedBundles: unknown[] = [];
    const uploadedUris: string[] = [];
    const token = 'migrate-secret-777';

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'unauthorized', message: 'bad token' }));
        return;
      }
      if (url.pathname === '/v1/meta') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ ok: true, generation: 'gen-mig', version: '0.1.0', capabilities: [] }),
        );
        return;
      }
      if (url.pathname === '/v1/files' && req.method === 'PUT') {
        uploadedUris.push(url.searchParams.get('uri') ?? '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ ok: true, uri: url.searchParams.get('uri'), version: 'sha256:123' }),
        );
        return;
      }
      if (url.pathname === '/v1/storage/rpc') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.from(c));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          method: string;
          args: unknown[];
        };
        if (body.method === 'workspaces.importBundle') {
          importedBundles.push(body.args[0]);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              result: {
                generation: 'gen-mig',
                revision: 1,
                changeCursor: '1',
                conversationState: { scope: null, sessions: [] },
              },
            }),
          );
          return;
        }
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const endpoint = `http://127.0.0.1:${port}`;
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const dir = await mkdtemp(join(tmpdir(), 'pulse-mig-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    process.env.PULSE_CANVAS_REMOTE_CONFIG = join(dir, 'remote-workspaces.json');

    // Mode B: keep storage local while routing runtime (PTY / CLI) to VPS.
    saveRemoteWorkspaceConfig('legacy-ws', {
      kind: 'vps',
      endpoint,
      token,
      storage: 'local',
      runtime: 'vps',
      cwd: '/srv/legacy',
    });
    expect(await getRemoteCanvasBackend('legacy-ws')).toBeNull();
    expect((await resolveRemoteWorkspaceTarget('legacy-ws', 'runtime'))?.cwd).toBe('/srv/legacy');
    expect(removeRemoteWorkspaceConfig('legacy-ws')).toBe(true);

    // Mode A: migrate an existing local workspace bundle + markdown note to VPS.
    const wsDir = join(dir, 'ws-files');
    await mkdir(join(wsDir, 'notes'), { recursive: true });
    await writeFile(join(wsDir, 'notes', 'intro.md'), '# Migrated Note', 'utf8');

    const fakeLocalStorage = {
      workspaces: {
        async readBundle(workspaceId: string) {
          return {
            canvas: {
              generation: 'local-gen',
              workspaceId,
              revision: 4,
              metadata: { title: 'Legacy Local' },
              nodes: [{ id: 'n1', type: 'note', title: 'Old Note' }],
              placements: [{ id: 'n1', nodeId: 'n1', x: 10, y: 20 }],
              edges: [],
            },
            conversationScope: {
              generation: 'local-gen',
              scopeId: workspaceId,
              revision: 1,
              currentSessionId: 's1',
              metadata: {},
            },
            conversations: [
              {
                generation: 'local-gen',
                scopeId: workspaceId,
                sessionId: 's1',
                revision: 2,
                metadata: { title: 'History' },
                messages: [{ id: 'm1', role: 'user', text: 'hello' }],
              },
            ],
            conversationState: { scope: null, sessions: [] },
          };
        },
      },
    } as unknown as Parameters<typeof migrateLocalWorkspaceToVps>[0]['localStorage'];

    const migRes = await migrateLocalWorkspaceToVps({
      workspaceId: 'legacy-ws',
      config: { kind: 'vps', endpoint, token, cwd: '/srv/legacy' },
      localStorage: fakeLocalStorage,
      localWorkspaceDir: wsDir,
    });

    expect(migRes.canvasRevision).toBe(1);
    expect(migRes.conversationCount).toBe(1);
    expect(migRes.uploadedFiles).toBe(1);
    expect(uploadedUris).toEqual(['pulse-remote:///legacy-ws/notes/intro.md']);
    expect(importedBundles).toHaveLength(1);
    expect(getRemoteWorkspaceConfig('legacy-ws')?.storage).toBe('vps');
  });
});
