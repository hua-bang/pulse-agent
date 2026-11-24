import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getRemoteWorkspaceConfig,
  listConfiguredRemoteWorkspaceIds,
  resolveRemoteToken,
  saveRemoteWorkspaceConfig,
} from './config';
import {
  closeAllRemoteConnections,
  getRemoteCanvasBackend,
  getRemoteWorkspaceFiles,
  resolveRemoteWorkspaceTarget,
  saveRemoteCanvas,
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

  it('routes resolveCanvasBackend to VPS and initializes empty VPS canvas on stale local revision', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulse-remote-resolve-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const cfgPath = join(dir, 'remote-workspaces.json');
    process.env.PULSE_CANVAS_REMOTE_CONFIG = cfgPath;
    const token = 'resolve-secret';
    let savedCanvas: {
      generation: string;
      workspaceId: string;
      revision: number;
      metadata: Record<string, unknown>;
      nodes: Array<Record<string, unknown>>;
      placements: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    } | null = null;

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/v1/meta') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, generation: 'gen-vps-1', version: '0.1.0', capabilities: [] }));
        return;
      }
      if (url.pathname === '/v1/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end();
        return;
      }
      if (url.pathname === '/v1/storage/rpc') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          method: string;
          args?: unknown[];
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (rpc.method === 'canvas.read') {
          res.end(JSON.stringify({ ok: true, result: savedCanvas }));
          return;
        }
        if (rpc.method === 'canvas.readNode') {
          const nodeId = rpc.args?.[1] as string | undefined;
          const node = savedCanvas?.nodes.find((item) => item.id === nodeId) ?? null;
          res.end(JSON.stringify({ ok: true, result: node }));
          return;
        }
        if (rpc.method === 'canvas.commit') {
          const input = (rpc.args?.[0] ?? {}) as {
            expectedRevision?: number | null;
            nodes?: { put?: Array<Record<string, unknown>> };
            placements?: { put?: Array<Record<string, unknown>> };
          };
          if (savedCanvas === null && input.expectedRevision !== null && input.expectedRevision !== undefined) {
            res.end(JSON.stringify({ ok: false, code: 'revision_conflict', message: 'conflict' }));
            return;
          }
          savedCanvas = {
            generation: 'gen-vps-1',
            workspaceId: 'ws-vps-agent',
            revision: (savedCanvas?.revision ?? 0) + 1,
            metadata: {},
            nodes: input.nodes?.put ?? [],
            placements: input.placements?.put ?? [],
            edges: [],
          };
          res.end(
            JSON.stringify({
              ok: true,
              result: {
                workspaceId: 'ws-vps-agent',
                revision: savedCanvas.revision,
                generation: 'gen-vps-1',
              },
            }),
          );
          return;
        }
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
    cleanups.push(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
    const addr = server.address();
    const endpoint = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

    saveRemoteWorkspaceConfig('ws-vps-agent', {
      kind: 'vps',
      endpoint,
      token,
      remoteWorkspaceId: 'ws-vps-agent',
      storage: 'vps',
      runtime: 'vps',
    });

    // First save after switching from local carries stale local revision & generation.
    const saveRes = await saveRemoteCanvas(
      'ws-vps-agent',
      {
        revision: 12,
        storageGeneration: 'local-gen-old',
        nodes: [{ id: 'node-vps-1', type: 'web', title: 'Notion Calendar', x: 0, y: 0 }],
        edges: [],
      },
      () => {},
    );
    expect(saveRes).toMatchObject({ ok: true, revision: 1, storageGeneration: 'gen-vps-1' });

    // Agent storage helpers resolve to VPS and read the saved node.
    const { STORE_DIR } = await import('../canvas/persistence/paths');
    const { resolveCanvasBackend } = await import('../canvas/persistence/backend');
    const resolved = await resolveCanvasBackend('ws-vps-agent', STORE_DIR);
    expect(resolved).not.toBeNull();
    const canvas = await resolved!.backend.readCanvas(resolved!.workspaceId);
    expect(canvas?.nodes).toHaveLength(1);
    expect((canvas?.nodes?.[0] as { id?: string })?.id).toBe('node-vps-1');
    const node = await resolved!.backend.readNode(resolved!.workspaceId, 'node-vps-1');
    expect((node as { title?: string } | null)?.title).toBe('Notion Calendar');
  });

  it('routes built-in Agent bash/read/write tools to VPS /v1/tools/exec when runtime=vps', async () => {
    const { saveRemoteWorkspaceConfig } = await import('./config');
    const { createCanvasAgentToolPolicy } = await import('../agent/tool-policy');

    const token = 'tools-exec-secret';
    const seenCalls: Array<{ tool: string; input: Record<string, unknown>; cwd?: string }> = [];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
        return;
      }
      if (url.pathname === '/v1/tools/exec' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.from(c));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          tool: string;
          input: Record<string, unknown>;
          cwd?: string;
        };
        seenCalls.push(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            result: body.tool === 'bash' ? { output: 'vps-host\n', exitCode: 0 } : { content: 'remote-file', totalLines: 1 },
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
    cleanups.push(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
    const addr = server.address();
    const endpoint = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

    saveRemoteWorkspaceConfig('ws-vps-tools', {
      kind: 'vps',
      endpoint,
      token,
      cwd: '/root/project/app',
      storage: 'vps',
      runtime: 'vps',
    });

    const policy = createCanvasAgentToolPolicy({ kind: 'workspace', workspaceId: 'ws-vps-tools' });
    const bashOut = await policy.builtInTools.bash.execute({ command: 'hostname' });
    expect(bashOut).toEqual({ output: 'vps-host\n', exitCode: 0 });

    const readOut = await policy.builtInTools.read.execute({ filePath: 'README.md' });
    expect(readOut).toEqual({ content: 'remote-file', totalLines: 1 });

    expect(seenCalls).toEqual([
      { tool: 'bash', input: { command: 'hostname' }, cwd: '/root/project/app' },
      { tool: 'read', input: { filePath: 'README.md' }, cwd: '/root/project/app' },
    ]);
  }, 15_000);

  it('relays allowlisted read-only capabilities and blocks unsafe or cross-workspace calls', async () => {
    const { startRemoteCapabilityRelay } = await import('./relay/capability-relay');
    const { CapabilityRuntime } = await import('../runtime/capabilities/runtime');
    const { z } = await import('zod');

    const token = 'relay-client-secret';
    const responses = new Map<string, { ok: boolean; value?: unknown; error?: { code: string; message: string } }>();
    let sseResRef: import('node:http').ServerResponse | null = null;
    const calledWorkspaces: string[] = [];

    const mockRuntime = new CapabilityRuntime([
      {
        name: 'browser.page.read',
        description: 'Read page',
        risk: 'read',
        inputSchema: z.object({ nodeId: z.string() }),
        execute: async (input, ctx) => {
          calledWorkspaces.push(ctx.workspaceId);
          return { nodeId: input.nodeId, text: 'Agenda from Notion' };
        },
      },
      {
        name: 'host.renderer.eval',
        description: 'Unsafe eval',
        risk: 'unsafe',
        inputSchema: z.object({ code: z.string() }),
        execute: async () => ({ evaled: true }),
      },
    ]);

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401);
        res.end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/runtime/relay/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': connected\n\n');
        sseResRef = res;
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/runtime/relay/respond') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.from(c));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          id: string;
          ok: boolean;
          value?: unknown;
          error?: { code: string; message: string };
        };
        responses.set(body.id, { ok: body.ok, value: body.value, error: body.error });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
    cleanups.push(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
    const addr = server.address();
    const endpoint = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

    const stop = startRemoteCapabilityRelay(
      {
        workspaceId: 'local-ws-1',
        remoteWorkspaceId: 'remote-ws-1',
        endpoint,
        token,
      },
      {
        resolveExecutor: () => ({
          list: () => mockRuntime.list({ kind: 'pulse-cli' }),
          call: (name, input, workspaceId) =>
            mockRuntime.call(name, input, { workspaceId, actor: { kind: 'pulse-cli' } }),
        }),
      },
    );
    cleanups.push(async () => stop());

    const waitFor = async (predicate: () => boolean) => {
      const deadline = Date.now() + 3_000;
      while (!predicate() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    await waitFor(() => sseResRef !== null);
    expect(sseResRef).not.toBeNull();

    // 1. capability_list filters out unsafe host.renderer.eval
    sseResRef!.write(`event: capability_list\ndata: ${JSON.stringify({ id: 'req-list' })}\n\n`);
    await waitFor(() => responses.has('req-list'));
    expect(responses.get('req-list')).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ name: 'browser.page.read' })],
    });
    expect((responses.get('req-list')?.value as Array<{ name: string }>).map((c) => c.name)).toEqual([
      'browser.page.read',
    ]);

    // 2. Allowed read capability translates remoteWorkspaceId -> localWorkspaceId
    sseResRef!.write(
      `event: capability_call\ndata: ${JSON.stringify({
        id: 'req-read',
        workspaceId: 'remote-ws-1',
        name: 'browser.page.read',
        input: { nodeId: 'iframe-notion' },
      })}\n\n`,
    );
    await waitFor(() => responses.has('req-read'));
    expect(responses.get('req-read')).toEqual({
      ok: true,
      value: { nodeId: 'iframe-notion', text: 'Agenda from Notion' },
    });
    expect(calledWorkspaces).toEqual(['local-ws-1']);

    // 3. Unsafe capability is rejected with capability_forbidden
    sseResRef!.write(
      `event: capability_call\ndata: ${JSON.stringify({
        id: 'req-unsafe',
        workspaceId: 'remote-ws-1',
        name: 'host.renderer.eval',
        input: { code: '1+1' },
      })}\n\n`,
    );
    await waitFor(() => responses.has('req-unsafe'));
    expect(responses.get('req-unsafe')).toMatchObject({
      ok: false,
      error: { code: 'capability_forbidden' },
    });

    // 4. Cross-workspace call is rejected with capability_forbidden
    sseResRef!.write(
      `event: capability_call\ndata: ${JSON.stringify({
        id: 'req-cross',
        workspaceId: 'other-ws',
        name: 'browser.page.read',
        input: { nodeId: 'iframe-other' },
      })}\n\n`,
    );
    await waitFor(() => responses.has('req-cross'));
    expect(responses.get('req-cross')).toMatchObject({
      ok: false,
      error: { code: 'capability_forbidden' },
    });
  });

  it('writes remote-workspaces.json with 0600 mode and delivers rapid PTY keystrokes in order', async () => {
    const { statSync } = await import('node:fs');
    const { saveRemoteWorkspaceConfig } = await import('./config');
    const { connectRemotePty } = await import('./runtime-client');

    const token = 'pty-order-secret';
    const receivedWrites: string[] = [];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401);
        res.end();
        return;
      }
      if (url.pathname === '/v1/pty/spawn') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pid: 1234, reused: false }));
        return;
      }
      if (url.pathname.endsWith('/stream')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': connected\n\n');
        return;
      }
      if (url.pathname.endsWith('/write')) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.from(c));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { data: string };
        receivedWrites.push(body.data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
    cleanups.push(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
    const addr = server.address();
    const endpoint = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

    const cfgDir = await mkdtemp(join(tmpdir(), 'pulse-remote-mode-'));
    cleanups.push(async () => rm(cfgDir, { recursive: true, force: true }));
    const prevEnv = process.env.PULSE_CANVAS_REMOTE_CONFIG;
    delete process.env.PULSE_CANVAS_REMOTE_CONFIG;
    try {
      saveRemoteWorkspaceConfig(
        'ws-mode-test',
        { kind: 'vps', endpoint, token, allowCapabilityRelay: false },
        cfgDir,
      );
      expect(statSync(join(cfgDir, 'remote-workspaces.json')).mode & 0o777).toBe(0o600);
    } finally {
      if (prevEnv !== undefined) process.env.PULSE_CANVAS_REMOTE_CONFIG = prevEnv;
    }

    const conn = await connectRemotePty(
      { workspaceId: 'ws-mode-test', remoteWorkspaceId: 'ws-mode-test', endpoint, token },
      { id: 'order-1', cols: 80, rows: 24 },
      { onData: () => {}, onExit: () => {} },
    );
    expect(conn.ok).toBe(true);
    if (conn.ok) {
      conn.handle.write('e');
      conn.handle.write('c');
      conn.handle.write('h');
      conn.handle.write('o');
      conn.handle.write(' hi\n');
      await new Promise((r) => setTimeout(r, 80));
      expect(receivedWrites.join('')).toBe('echo hi\n');
      expect(receivedWrites.length).toBeLessThanOrEqual(2);
      conn.handle.detach();
    }
  });

  it('suppresses viewer save 403s and skips overwriting populated remote workspaces when onlyIfRemoteEmpty=true', async () => {
    const { saveRemoteWorkspaceConfig } = await import('./config');
    const { saveRemoteCanvas, tryWriteRemoteTextFile } = await import('./client');
    const { migrateLocalWorkspaceToVps } = await import('./migrate');

    const token = 'viewer-guard-secret';
    let commitHits = 0;
    let filePutHits = 0;

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401);
        res.end();
        return;
      }
      if (url.pathname === '/v1/meta') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, generation: 'gen-v', version: '0.2.0', capabilities: [] }));
        return;
      }
      if (url.pathname === '/v1/events' || url.pathname === '/v1/runtime/relay/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': connected\n\n');
        return;
      }
      if (url.pathname === '/v1/files' && req.method === 'PUT') {
        filePutHits += 1;
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
        return;
      }
      if (url.pathname === '/v1/storage/rpc') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.from(c));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { method: string };
        if (body.method === 'canvas.commit' || body.method === 'workspaces.importBundle') {
          commitHits += 1;
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
          return;
        }
        if (body.method === 'canvas.read') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              result: {
                workspaceId: 'ws-existing-remote',
                revision: 5,
                nodes: [{ id: 'existing-1', type: 'note', title: 'Remote Node' }],
                placements: [],
                edges: [],
              },
            }),
          );
          return;
        }
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
    cleanups.push(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
    const addr = server.address();
    const endpoint = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

    saveRemoteWorkspaceConfig('ws-viewer-1', {
      kind: 'vps',
      endpoint,
      token,
      shareRole: 'viewer',
      allowCapabilityRelay: false,
    });

    const saveRes = await saveRemoteCanvas('ws-viewer-1', { revision: 3, nodes: [], edges: [] }, () => {});
    expect(saveRes).toMatchObject({ ok: true, revision: 3 });
    const noteRes = await tryWriteRemoteTextFile({
      filePath: '/home/user/.pulse-coder/canvas/ws-viewer-1/notes/n1.md',
      content: 'edited by viewer',
    });
    expect(noteRes).toMatchObject({ ok: true });
    expect(commitHits).toBe(0);
    expect(filePutHits).toBe(0);

    // onlyIfRemoteEmpty=true must NOT overwrite an already-populated remote workspace.
    const fakeLocalStorage = {
      workspaces: {
        readBundle: async () => ({
          canvas: {
            workspaceId: 'ws-existing-remote',
            metadata: {},
            nodes: [{ id: 'local-1', type: 'note', title: 'Local Node' }],
            placements: [],
            edges: [],
          },
          conversations: [],
          conversationScope: null,
        }),
      },
    } as unknown as import('@pulse-coder/storage').PulseStorage;

    const migRes = await migrateLocalWorkspaceToVps({
      workspaceId: 'ws-existing-remote',
      config: { kind: 'vps', endpoint, token, allowCapabilityRelay: false },
      localStorage: fakeLocalStorage,
      onlyIfRemoteEmpty: true,
    });
    expect(migRes).toMatchObject({ migrated: false, canvasRevision: 5 });
    expect(commitHits).toBe(0);
  });

  it('matches cross-machine remoteWorkspaceId paths and round-trips binary images, workspace JSON files, and remote workspace-doc', async () => {
    const { saveRemoteWorkspaceConfig, matchRemoteWorkspaceFile } = await import('./config');
    const {
      tryWriteRemoteBinaryFile,
      tryReadRemoteBinaryFile,
      writeRemoteWorkspaceText,
      readRemoteWorkspaceText,
      readRemoteWorkspaceDocById,
    } = await import('./workspace-files');

    const storedFiles = new Map<string, string>();
    const token = 'sync-secret-999';
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'unauthorized' }));
        return;
      }
      if (url.pathname === '/v1/files' && req.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.from(c));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { base64: string };
        const uri = url.searchParams.get('uri') ?? '';
        storedFiles.set(uri, body.base64);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, uri, version: 'sha256:abc' }));
        return;
      }
      if (url.pathname === '/v1/files' && req.method === 'GET') {
        const uri = url.searchParams.get('uri') ?? '';
        const base64 = storedFiles.get(uri);
        if (!base64) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'not_found', message: 'not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, uri, version: 'sha256:abc', base64 }));
        return;
      }
      if (url.pathname === '/v1/workspace-doc' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, exists: true, content: '# Remote Workspace Doc' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
    cleanups.push(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
    const addr = server.address();
    const endpoint = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

    saveRemoteWorkspaceConfig('ws-guest-local', {
      kind: 'vps',
      endpoint,
      token,
      remoteWorkspaceId: 'ws-owner-origin',
      cwd: '/srv/pulse-app',
      storage: 'vps',
      runtime: 'vps',
      allowCapabilityRelay: false,
    });

    // Cross-machine path carrying owner's remoteWorkspaceId must match guest's local workspace config.
    const crossPath = '/Users/macA/.pulse-coder/canvas/ws-owner-origin/images/arch.png';
    expect(matchRemoteWorkspaceFile(crossPath)).toEqual({
      workspaceId: 'ws-guest-local',
      relPath: 'images/arch.png',
    });

    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(await tryWriteRemoteBinaryFile(crossPath, pngBytes)).toBe(true);
    const readImg = await tryReadRemoteBinaryFile(crossPath);
    expect(readImg?.mimeType).toBe('image/png');
    expect(Array.from(readImg?.bytes ?? [])).toEqual(Array.from(pngBytes));

    expect(await writeRemoteWorkspaceText('ws-guest-local', 'references.json', '{"version":1,"references":[]}')).toBe(true);
    const readRef = await readRemoteWorkspaceText('ws-guest-local', 'references.json');
    expect(readRef).toEqual({ exists: true, content: '{"version":1,"references":[]}' });

    const doc = await readRemoteWorkspaceDocById('ws-guest-local');
    expect(doc).toBe('# Remote Workspace Doc');
  });
});
