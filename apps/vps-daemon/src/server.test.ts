import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isStorageError, type StorageChange } from '@pulse-coder/storage';
import {
  createRemoteWorkspaceFiles,
  openRemoteStorage,
  subscribeRemoteChanges,
} from '@pulse-coder/storage/remote';
import type { ManagedPtyProcess, PtySpawner } from './pty-hub.js';
import { startVpsDaemon, type RunningVpsDaemon } from './server.js';

function createFakePtySpawner(): { spawner: PtySpawner; emitted: string[] } {
  const emitted: string[] = [];
  let nextPid = 9000;
  const spawner: PtySpawner = async () => {
    const pid = nextPid++;
    const dataListeners: Array<(data: string) => void> = [];
    const exitListeners: Array<(event: { exitCode: number }) => void> = [];
    const proc: ManagedPtyProcess = {
      pid,
      write(data: string) {
        emitted.push(data);
        for (const fn of dataListeners) fn(`echo:${data}`);
      },
      resize() {},
      kill() {
        for (const fn of exitListeners) fn({ exitCode: 0 });
      },
      onData(listener) {
        dataListeners.push(listener);
      },
      onExit(listener) {
        exitListeners.push(listener);
      },
    };
    return proc;
  };
  return { spawner, emitted };
}

describe('vps-daemon end-to-end', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()?.();
    }
  });

  async function boot(): Promise<{ daemon: RunningVpsDaemon; token: string; root: string }> {
    const root = await mkdtemp(join(tmpdir(), 'pulse-vps-daemon-'));
    const token = 'test-secret-token-12345';
    const { spawner } = createFakePtySpawner();
    const daemon = await startVpsDaemon({
      host: '127.0.0.1',
      port: 0,
      token,
      dataDir: root,
      workDir: root,
      pollIntervalMs: 50,
      ptySpawner: spawner,
    });
    cleanups.push(async () => {
      await daemon.close();
      await rm(root, { recursive: true, force: true });
    });
    return { daemon, token, root };
  }

  it('rejects unauthenticated requests on /v1/* and serves /health', async () => {
    const { daemon } = await boot();
    const health = await fetch(`${daemon.url}/health`);
    expect(health.status).toBe(200);

    const unauth = await fetch(`${daemon.url}/v1/meta`);
    expect(unauth.status).toBe(401);
  });

  it('round-trips Canvas, Conversations, revision conflicts, and WorkspaceFiles via @pulse-coder/storage/remote', async () => {
    const { daemon, token } = await boot();
    const remote = await openRemoteStorage({ endpoint: daemon.url, token });
    expect(remote.generation).toBe(daemon.storage.generation);

    const receipt1 = await remote.canvas.commit({
      workspaceId: 'ws-remote-1',
      expectedRevision: null,
      metadata: { title: 'VPS Workspace' },
      nodes: { put: [{ id: 'n1', type: 'note', title: 'Hello VPS' }] },
    });
    expect(receipt1.revision).toBe(1);

    const snap = await remote.canvas.read('ws-remote-1');
    expect(snap?.nodes).toHaveLength(1);
    expect(snap?.nodes[0].title).toBe('Hello VPS');

    // Stale revision must surface as StorageError('revision_conflict').
    await expect(
      remote.canvas.commit({
        workspaceId: 'ws-remote-1',
        expectedRevision: 999,
        nodes: { put: [{ id: 'n2', type: 'note' }] },
      }),
    ).rejects.toSatisfy((err: unknown) => isStorageError(err) && err.code === 'revision_conflict');

    // Conversation round-trip.
    const convReceipt = await remote.conversations.commit({
      scopeId: 'ws-remote-1',
      sessionId: 'sess-1',
      expectedRevision: null,
      metadata: { title: 'Chat' },
      appendMessages: [{ id: 'm1', role: 'user', text: 'hi' }],
    });
    expect(convReceipt.revision).toBe(1);
    const conv = await remote.conversations.read('ws-remote-1', 'sess-1');
    expect(conv?.messages).toHaveLength(1);

    // WorkspaceFiles CAS round-trip & path traversal rejection.
    const files = createRemoteWorkspaceFiles({ endpoint: daemon.url, token });
    const uri = files.uriForPath('ws-remote-1/notes/hello.md');
    const written = await files.write(uri, '# Hello from VPS', { expectedVersion: null });
    expect(written.version.startsWith('sha256:')).toBe(true);

    const readBack = await files.readText(uri);
    expect(readBack?.content).toBe('# Hello from VPS');
    expect(readBack?.version).toBe(written.version);

    await expect(
      files.write(uri, 'overwrite', { expectedVersion: 'sha256:deadbeef' }),
    ).rejects.toSatisfy((err: unknown) => isStorageError(err) && err.code === 'revision_conflict');

    await expect(files.readText('pulse-remote:///../../etc/passwd')).rejects.toSatisfy(
      (err: unknown) => isStorageError(err) && err.code === 'invalid_argument',
    );

    await remote.close();
  });

  it('streams StorageChange events over SSE when commits happen', async () => {
    const { daemon, token } = await boot();
    const remote = await openRemoteStorage({ endpoint: daemon.url, token });
    const received: StorageChange[] = [];

    const stop = subscribeRemoteChanges(
      { endpoint: daemon.url, token, scopeId: 'ws-live' },
      (change) => received.push(change),
    );
    cleanups.push(async () => stop());

    // Wait briefly for SSE connection to register, then commit directly on the VPS store.
    await new Promise((r) => setTimeout(r, 80));
    await remote.canvas.commit({
      workspaceId: 'ws-live',
      expectedRevision: null,
      nodes: { put: [{ id: 'n-live', type: 'note' }] },
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(received.some((c) => c.scopeId === 'ws-live' && c.domain === 'canvas')).toBe(true);
    await remote.close();
  });

  it('keeps PTY sessions alive across detach/reattach and streams exec-jsonl output', async () => {
    const { daemon, token, root: dir } = await boot();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const spawnRes = await fetch(`${daemon.url}/v1/pty/spawn`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 'term-1', cols: 100, rows: 30 }),
    });
    const spawnJson = (await spawnRes.json()) as { ok: boolean; reused: boolean; pid: number };
    expect(spawnJson.ok).toBe(true);
    expect(spawnJson.reused).toBe(false);

    await fetch(`${daemon.url}/v1/pty/term-1/write`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: 'hello\n' }),
    });

    // Re-spawning the same id reuses the running session and preserves scrollback.
    const reuseRes = await fetch(`${daemon.url}/v1/pty/spawn`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 'term-1' }),
    });
    const reuseJson = (await reuseRes.json()) as { ok: boolean; reused: boolean; pid: number };
    expect(reuseJson.reused).toBe(true);
    expect(reuseJson.pid).toBe(spawnJson.pid);

    const sbRes = await fetch(`${daemon.url}/v1/pty/term-1/scrollback`, { headers });
    const sbJson = (await sbRes.json()) as { ok: boolean; text: string };
    expect(sbJson.text).toContain('echo:hello');

    // Stream JSONL output via /v1/exec-jsonl.
    const execRes = await fetch(`${daemon.url}/v1/exec-jsonl`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        command: process.execPath,
        args: ['-e', 'console.log(JSON.stringify({ type: "msg", ok: true }))'],
      }),
    });
    expect(execRes.status).toBe(200);
    const sseText = await execRes.text();
    expect(sseText).toContain('event: line');
    expect(sseText).toContain('\\"type\\":\\"msg\\"');
    expect(sseText).toContain('event: exit');

    // Workspace doc (pulse-workspace.md) round-trip.
    const docMissing = await fetch(`${daemon.url}/v1/workspace-doc`, { headers });
    const docMissingJson = await docMissing.json() as { ok: boolean; exists: boolean; content: string | null };
    expect(docMissingJson.ok).toBe(true);
    expect(docMissingJson.exists).toBe(false);

    const docWrite = await fetch(`${daemon.url}/v1/workspace-doc`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ content: '# Remote Goal\nShip it' }),
    });
    expect(docWrite.status).toBe(200);

    const docRead = await fetch(`${daemon.url}/v1/workspace-doc`, { headers });
    const docReadJson = await docRead.json() as { ok: boolean; exists: boolean; content: string };
    expect(docReadJson.exists).toBe(true);
    expect(docReadJson.content).toBe('# Remote Goal\nShip it');

    // Directory listing via /v1/fs/list-dirs.
    await mkdir(join(dir, 'projects'), { recursive: true });
    await mkdir(join(dir, '.secret-dir'), { recursive: true });
    const listRes = await fetch(`${daemon.url}/v1/fs/list-dirs?path=${encodeURIComponent(dir)}`, { headers });
    const listJson = await listRes.json() as {
      ok: boolean;
      path: string;
      parent: string | null;
      entries: Array<{ name: string; path: string; hidden: boolean }>;
    };
    expect(listJson.ok).toBe(true);
    expect(listJson.path).toBe(dir);
    expect(listJson.entries.map((entry) => entry.name)).toContain('projects');
    expect(listJson.entries.map((entry) => entry.name)).not.toContain('.secret-dir');

    const listHiddenRes = await fetch(
      `${daemon.url}/v1/fs/list-dirs?path=${encodeURIComponent(dir)}&showHidden=1`,
      { headers },
    );
    const listHiddenJson = await listHiddenRes.json() as {
      ok: boolean;
      entries: Array<{ name: string }>;
    };
    expect(listHiddenJson.entries.map((entry) => entry.name)).toContain('.secret-dir');
  });

  it('enforces scoped share roles (viewer, editor, collaborator) and supports revocation', async () => {
    const { daemon, token } = await boot();
    const adminHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Seed workspace ws-shared.
    const adminRemote = await openRemoteStorage({ endpoint: daemon.url, token });
    await adminRemote.canvas.commit({
      workspaceId: 'ws-shared',
      expectedRevision: null,
      nodes: { put: [{ id: 'n1', type: 'note', title: 'Shared Note' }] },
    });
    await adminRemote.close();

    // Mint viewer, editor, and collaborator tokens.
    const mint = async (role: 'viewer' | 'editor' | 'collaborator') => {
      const res = await fetch(`${daemon.url}/v1/shares`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ workspaceId: 'ws-shared', role, label: role }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; share: { id: string; token: string; role: string } };
      return body.share;
    };
    const viewer = await mint('viewer');
    const editor = await mint('editor');
    const collab = await mint('collaborator');

    const viewerHeaders = { Authorization: `Bearer ${viewer.token}`, 'Content-Type': 'application/json' };
    const editorHeaders = { Authorization: `Bearer ${editor.token}`, 'Content-Type': 'application/json' };
    const collabHeaders = { Authorization: `Bearer ${collab.token}`, 'Content-Type': 'application/json' };

    // Viewer can read ws-shared canvas, but cannot read another workspace, write canvas, spawn PTY, or manage shares.
    const vRead = await fetch(`${daemon.url}/v1/storage/rpc`, {
      method: 'POST',
      headers: viewerHeaders,
      body: JSON.stringify({ method: 'canvas.read', args: ['ws-shared'] }),
    });
    expect(vRead.status).toBe(200);

    const vCrossWs = await fetch(`${daemon.url}/v1/storage/rpc`, {
      method: 'POST',
      headers: viewerHeaders,
      body: JSON.stringify({ method: 'canvas.read', args: ['ws-other'] }),
    });
    expect(vCrossWs.status).toBe(403);

    const vWrite = await fetch(`${daemon.url}/v1/storage/rpc`, {
      method: 'POST',
      headers: viewerHeaders,
      body: JSON.stringify({ method: 'canvas.commit', args: [{ workspaceId: 'ws-shared', expectedRevision: 1 }] }),
    });
    expect(vWrite.status).toBe(403);

    const vPty = await fetch(`${daemon.url}/v1/pty/spawn`, {
      method: 'POST',
      headers: viewerHeaders,
      body: JSON.stringify({ id: 'p1' }),
    });
    expect(vPty.status).toBe(403);

    // Editor can commit to ws-shared, but cannot spawn PTY or run exec-jsonl.
    const eWrite = await fetch(`${daemon.url}/v1/storage/rpc`, {
      method: 'POST',
      headers: editorHeaders,
      body: JSON.stringify({
        method: 'canvas.commit',
        args: [{ workspaceId: 'ws-shared', expectedRevision: 1, nodes: { put: [{ id: 'n2', type: 'text' }] } }],
      }),
    });
    expect(eWrite.status).toBe(200);

    const ePty = await fetch(`${daemon.url}/v1/pty/spawn`, {
      method: 'POST',
      headers: editorHeaders,
      body: JSON.stringify({ id: 'p2' }),
    });
    expect(ePty.status).toBe(403);

    // Collaborator can spawn PTY, but cannot manage shares.
    const cPty = await fetch(`${daemon.url}/v1/pty/spawn`, {
      method: 'POST',
      headers: collabHeaders,
      body: JSON.stringify({ id: 'p3' }),
    });
    expect(cPty.status).toBe(200);

    const cShares = await fetch(`${daemon.url}/v1/shares`, { headers: collabHeaders });
    expect(cShares.status).toBe(403);

    // Revoking viewer token immediately invalidates it.
    const delRes = await fetch(`${daemon.url}/v1/shares/${viewer.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(delRes.status).toBe(200);

    const afterRevoke = await fetch(`${daemon.url}/v1/meta`, { headers: viewerHeaders });
    expect(afterRevoke.status).toBe(401);
  });

  it('executes remote builtin tools (bash/read/write/edit/ls/grep) and enforces runtime role', async () => {
    const { daemon, token, root } = await boot();
    const adminHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const workRoot = join(root, 'proj');

    const callTool = async (
      headers: Record<string, string>,
      tool: string,
      input: Record<string, unknown>,
    ) => {
      const res = await fetch(`${daemon.url}/v1/tools/exec`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tool, input, cwd: workRoot }),
      });
      return { status: res.status, body: (await res.json()) as { ok: boolean; result?: any; error?: string } };
    };

    const writeRes = await callTool(adminHeaders, 'write', { filePath: 'hello.txt', content: 'hello world\nsecond line\n' });
    expect(writeRes.status).toBe(200);
    expect(writeRes.body.result).toMatchObject({ success: true, created: true });

    const editRes = await callTool(adminHeaders, 'edit', { filePath: 'hello.txt', oldString: 'world', newString: 'vps' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.result).toMatchObject({ success: true, replacements: 1 });

    const readRes = await callTool(adminHeaders, 'read', { filePath: 'hello.txt' });
    expect(readRes.status).toBe(200);
    expect(readRes.body.result.content).toContain('hello vps');

    const lsRes = await callTool(adminHeaders, 'ls', {});
    expect(lsRes.status).toBe(200);
    expect(lsRes.body.result.files).toContain('hello.txt');

    const grepRes = await callTool(adminHeaders, 'grep', { pattern: 'hello vps', outputMode: 'content' });
    expect(grepRes.status).toBe(200);
    expect(grepRes.body.result.output).toContain('hello vps');

    const bashRes = await callTool(adminHeaders, 'bash', { command: 'pwd && cat hello.txt' });
    expect(bashRes.status).toBe(200);
    expect(bashRes.body.result.exitCode).toBe(0);
    expect(bashRes.body.result.output).toContain('hello vps');

    // Editor role must be rejected from /v1/tools/exec (403).
    const shareRes = await fetch(`${daemon.url}/v1/shares`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ workspaceId: 'ws-shared', role: 'editor', label: 'editor-only' }),
    });
    const shareBody = (await shareRes.json()) as { share: { token: string } };
    const editorHeaders = { Authorization: `Bearer ${shareBody.share.token}`, 'Content-Type': 'application/json' };
    const denied = await callTool(editorHeaders, 'bash', { command: 'echo nope' });
    expect(denied.status).toBe(403);
  });

  it('relays capability list and call requests to connected desktop SSE clients', async () => {
    const { daemon, token } = await boot();
    const adminHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Without a connected desktop client, capability calls report runtime_unreachable.
    const offline = await fetch(`${daemon.url}/v1/runtime/capabilities/call`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ workspaceId: 'ws-relay', name: 'browser.page.read', input: {} }),
    });
    expect(offline.status).toBe(200);
    expect(await offline.json()).toMatchObject({
      ok: false,
      error: { code: 'runtime_unreachable' },
    });

    // Connect a simulated desktop client to the outbound SSE relay.
    const ac = new AbortController();
    const sseRes = await fetch(`${daemon.url}/v1/runtime/relay/events?workspaceId=ws-relay`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();

    const pumpPromise = (async () => {
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const evLine = frame.split('\n').find((l) => l.startsWith('event:'));
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (evLine && dataLine) {
            const ev = evLine.slice(6).trim();
            const payload = JSON.parse(dataLine.slice(5).trim()) as { id: string; name?: string };
            if (ev === 'capability_list') {
              await fetch(`${daemon.url}/v1/runtime/relay/respond`, {
                method: 'POST',
                headers: adminHeaders,
                body: JSON.stringify({ id: payload.id, ok: true, value: [{ name: 'browser.page.read', risk: 'read' }] }),
              });
            } else if (ev === 'capability_call') {
              await fetch(`${daemon.url}/v1/runtime/relay/respond`, {
                method: 'POST',
                headers: adminHeaders,
                body: JSON.stringify({ id: payload.id, ok: true, value: { title: 'Notion Calendar', text: 'Standup 10:00' } }),
              });
            }
          }
          idx = buf.indexOf('\n\n');
        }
      }
    })().catch(() => undefined);

    // Wait briefly for SSE registration to settle.
    await new Promise((r) => setTimeout(r, 40));

    const listRes = await fetch(`${daemon.url}/v1/runtime/capabilities/list`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ workspaceId: 'ws-relay' }),
    });
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({
      ok: true,
      capabilities: [{ name: 'browser.page.read', risk: 'read' }],
    });

    const callRes = await fetch(`${daemon.url}/v1/runtime/capabilities/call`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ workspaceId: 'ws-relay', name: 'browser.page.read', input: { nodeId: 'iframe-1' } }),
    });
    expect(callRes.status).toBe(200);
    expect(await callRes.json()).toEqual({
      ok: true,
      value: { title: 'Notion Calendar', text: 'Standup 10:00' },
    });

    ac.abort();
    await pumpPromise;
  });

  it('exposes bundleHash on /health & /v1/meta and confines /v1/workspace-doc for share tokens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pulse-vps-hardening-'));
    const token = 'hardening-secret-token';
    const { spawner } = createFakePtySpawner();
    const daemon = await startVpsDaemon({
      host: '127.0.0.1',
      port: 0,
      token,
      dataDir: root,
      workDir: root,
      bundleHash: 'deadbeef12345678',
      pollIntervalMs: 50,
      ptySpawner: spawner,
    });
    cleanups.push(async () => {
      await daemon.close();
      await rm(root, { recursive: true, force: true });
    });

    const healthRes = await fetch(`${daemon.url}/health`);
    expect(await healthRes.json()).toMatchObject({ ok: true, bundleHash: 'deadbeef12345678' });

    const adminHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const metaRes = await fetch(`${daemon.url}/v1/meta`, { headers: adminHeaders });
    expect(await metaRes.json()).toMatchObject({
      ok: true,
      bundleHash: 'deadbeef12345678',
      capabilities: expect.arrayContaining(['tools-exec', 'capability-relay']),
    });

    const shareRes = await fetch(`${daemon.url}/v1/shares`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ workspaceId: 'ws-confined', role: 'editor', label: 'ed' }),
    });
    const shareBody = (await shareRes.json()) as { share: { token: string } };
    const editorHeaders = { Authorization: `Bearer ${shareBody.share.token}`, 'Content-Type': 'application/json' };

    // Writing inside workDir succeeds.
    const okWrite = await fetch(`${daemon.url}/v1/workspace-doc`, {
      method: 'PUT',
      headers: editorHeaders,
      body: JSON.stringify({ cwd: join(root, 'sub'), content: '# OK' }),
    });
    expect(okWrite.status).toBe(200);

    // Reading or writing outside workDir is blocked (403).
    const badRead = await fetch(`${daemon.url}/v1/workspace-doc?cwd=${encodeURIComponent('/tmp')}`, {
      headers: editorHeaders,
    });
    expect(badRead.status).toBe(403);

    const badWrite = await fetch(`${daemon.url}/v1/workspace-doc`, {
      method: 'PUT',
      headers: editorHeaders,
      body: JSON.stringify({ cwd: '/tmp', content: '# Escape' }),
    });
    expect(badWrite.status).toBe(403);
  });

  it('blocks /v1/files path traversal and symlink escape for share tokens', async () => {
    const { daemon, token, root } = await boot();
    const adminHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    await mkdir(join(root, 'ws-shared'), { recursive: true });
    await mkdir(join(root, 'ws-other'), { recursive: true });
    await writeFile(join(root, 'ws-shared', 'note.md'), 'shared ok', 'utf8');
    await writeFile(join(root, 'ws-other', 'memory.json'), '{"secret":"other-ws"}', 'utf8');
    await symlink(join(root, 'ws-other', 'memory.json'), join(root, 'ws-shared', 'escape.json'));

    const mint = async (role: 'viewer' | 'editor') => {
      const res = await fetch(`${daemon.url}/v1/shares`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ workspaceId: 'ws-shared', role }),
      });
      return ((await res.json()) as { share: { token: string } }).share.token;
    };
    const viewerHeaders = { Authorization: `Bearer ${await mint('viewer')}` };
    const editorHeaders = {
      Authorization: `Bearer ${await mint('editor')}`,
      'Content-Type': 'application/json',
    };

    // In-scope read succeeds.
    const okRead = await fetch(
      `${daemon.url}/v1/files?uri=${encodeURIComponent('pulse-remote:///ws-shared/note.md')}`,
      { headers: viewerHeaders },
    );
    expect(okRead.status).toBe(200);

    // Path traversal to sibling workspace, share-tokens.json, SQLite DB, backslash, and symlink must all be 403.
    const traversalUris = [
      'pulse-remote:///ws-shared/../ws-other/memory.json',
      'pulse-remote:///ws-shared/../share-tokens.json',
      'pulse-remote:///ws-shared/../__storage__.sqlite',
      'pulse-remote:///ws-shared/sub/../../ws-other/memory.json',
      'pulse-remote:///ws-shared\\..\\ws-other\\memory.json',
      'pulse-remote:///ws-shared/escape.json',
    ];
    for (const uri of traversalUris) {
      const readRes = await fetch(`${daemon.url}/v1/files?uri=${encodeURIComponent(uri)}`, {
        headers: viewerHeaders,
      });
      expect(readRes.status, `GET ${uri}`).toBe(403);

      const writeRes = await fetch(`${daemon.url}/v1/files?uri=${encodeURIComponent(uri)}`, {
        method: 'PUT',
        headers: editorHeaders,
        body: JSON.stringify({ base64: Buffer.from('pwned').toString('base64') }),
      });
      expect(writeRes.status, `PUT ${uri}`).toBe(403);

      const delRes = await fetch(`${daemon.url}/v1/files?uri=${encodeURIComponent(uri)}`, {
        method: 'DELETE',
        headers: editorHeaders,
      });
      expect(delRes.status, `DELETE ${uri}`).toBe(403);
    }

    // Creating a share token with traversal workspaceId must fail with 400.
    const badShare = await fetch(`${daemon.url}/v1/shares`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ workspaceId: '../ws-other', role: 'viewer' }),
    });
    expect(badShare.status).toBe(400);
  });

  it('isolates fileWrites.* and changes.read RPCs per workspace for share tokens', async () => {
    const { daemon, token } = await boot();
    const adminHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const adminRemote = await openRemoteStorage({ endpoint: daemon.url, token });

    const makeFileWrite = (id: string, uri: string) => {
      const content = `secret-${id}`;
      return {
        id,
        nodeId: `node-${id}`,
        uri,
        baseVersion: null,
        targetVersion: `sha256:${createHash('sha256').update(content).digest('hex')}`,
        baseContent: null,
        content,
      };
    };

    const sharedFw = makeFileWrite('fw-shared', 'pulse-remote:///ws-shared/a.md');
    const otherFw = makeFileWrite('fw-other', 'pulse-remote:///ws-other/b.md');

    await adminRemote.canvas.commit({
      workspaceId: 'ws-shared',
      expectedRevision: null,
      nodes: {
        put: [{ id: sharedFw.nodeId, type: 'file', data: { filePath: 'a.md', content: sharedFw.content } }],
      },
      fileWrites: [sharedFw],
    });
    await adminRemote.canvas.commit({
      workspaceId: 'ws-other',
      expectedRevision: null,
      nodes: {
        put: [{ id: otherFw.nodeId, type: 'file', data: { filePath: 'b.md', content: otherFw.content } }],
      },
      fileWrites: [otherFw],
    });
    await adminRemote.close();

    const mint = async (role: 'viewer' | 'editor') => {
      const res = await fetch(`${daemon.url}/v1/shares`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ workspaceId: 'ws-shared', role }),
      });
      return ((await res.json()) as { share: { token: string } }).share.token;
    };
    const viewerHeaders = {
      Authorization: `Bearer ${await mint('viewer')}`,
      'Content-Type': 'application/json',
    };
    const editorHeaders = {
      Authorization: `Bearer ${await mint('editor')}`,
      'Content-Type': 'application/json',
    };

    const rpc = async (headers: Record<string, string>, method: string, args: unknown[]) => {
      const res = await fetch(`${daemon.url}/v1/storage/rpc`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method, args }),
      });
      return { status: res.status, body: (await res.json()) as { ok: boolean; result?: any } };
    };

    // fileWrites.list without workspaceId only returns ws-shared items.
    const fwList = await rpc(editorHeaders, 'fileWrites.list', [{}]);
    expect(fwList.status).toBe(200);
    expect(fwList.body.result.items.map((item: { id: string }) => item.id)).toEqual(['fw-shared']);

    // fileWrites.list targeting ws-other is forbidden.
    const fwListOther = await rpc(editorHeaders, 'fileWrites.list', [{ workspaceId: 'ws-other' }]);
    expect(fwListOther.status).toBe(403);

    // fileWrites.get / settle allow ws-shared but forbid ws-other.
    expect((await rpc(editorHeaders, 'fileWrites.get', ['fw-shared'])).status).toBe(200);
    expect((await rpc(editorHeaders, 'fileWrites.get', ['fw-other'])).status).toBe(403);
    expect(
      (await rpc(editorHeaders, 'fileWrites.settle', ['fw-other', { status: 'applied' }])).status,
    ).toBe(403);
    expect(
      (await rpc(editorHeaders, 'fileWrites.settle', ['fw-shared', { status: 'applied' }])).status,
    ).toBe(200);

    // changes.read without scopeId filters results strictly to ws-shared.
    const changes = await rpc(viewerHeaders, 'changes.read', [{ limit: 100 }]);
    expect(changes.status).toBe(200);
    const items = changes.body.result.items as StorageChange[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.scopeId === 'ws-shared')).toBe(true);

    // changes.read explicitly targeting ws-other is forbidden.
    const changesOther = await rpc(viewerHeaders, 'changes.read', [{ scopeId: 'ws-other' }]);
    expect(changesOther.status).toBe(403);

    // workspaces.getTrashed is allowed for ws-shared (needed by Pulse Agent session loading)
    // and forbidden for ws-other.
    const trashedShared = await rpc(viewerHeaders, 'workspaces.getTrashed', ['ws-shared']);
    expect(trashedShared.status).toBe(200);
    expect(trashedShared.body.result).toBeNull();
    expect((await rpc(editorHeaders, 'workspaces.getTrashed', ['ws-shared'])).status).toBe(200);
    expect((await rpc(viewerHeaders, 'workspaces.getTrashed', ['ws-other'])).status).toBe(403);
    expect((await rpc(editorHeaders, 'workspaces.getTrashed', ['ws-other'])).status).toBe(403);
  });

  it('enforces role and workspace isolation on all /v1/pty/* routes', async () => {
    const { daemon, token } = await boot();
    const adminHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Admin spawns sessions for ws-shared, ws-other, and an unscoped admin session.
    for (const [id, workspaceId] of [
      ['pty-shared', 'ws-shared'],
      ['pty-other', 'ws-other'],
      ['pty-admin', undefined],
    ] as const) {
      const res = await fetch(`${daemon.url}/v1/pty/spawn`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ id, ...(workspaceId ? { workspaceId } : {}) }),
      });
      expect(res.status).toBe(200);
    }

    const mint = async (role: 'viewer' | 'editor' | 'collaborator') => {
      const res = await fetch(`${daemon.url}/v1/shares`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ workspaceId: 'ws-shared', role }),
      });
      return ((await res.json()) as { share: { token: string } }).share.token;
    };
    const viewerHeaders = { Authorization: `Bearer ${await mint('viewer')}` };
    const editorHeaders = { Authorization: `Bearer ${await mint('editor')}` };
    const collabHeaders = {
      Authorization: `Bearer ${await mint('collaborator')}`,
      'Content-Type': 'application/json',
    };

    // Viewer and editor cannot read PTY GET routes.
    for (const headers of [viewerHeaders, editorHeaders]) {
      expect((await fetch(`${daemon.url}/v1/pty/pty-shared/scrollback`, { headers })).status).toBe(403);
      expect((await fetch(`${daemon.url}/v1/pty/pty-shared/cwd`, { headers })).status).toBe(403);
      expect((await fetch(`${daemon.url}/v1/pty/pty-shared/stream`, { headers })).status).toBe(403);
    }

    // Collaborator can access ws-shared PTY.
    expect((await fetch(`${daemon.url}/v1/pty/pty-shared/scrollback`, { headers: collabHeaders })).status).toBe(200);
    expect(
      (
        await fetch(`${daemon.url}/v1/pty/pty-shared/write`, {
          method: 'POST',
          headers: collabHeaders,
          body: JSON.stringify({ data: 'ok\n' }),
        })
      ).status,
    ).toBe(200);

    // Collaborator cannot access ws-other or unscoped admin PTY sessions.
    for (const foreignId of ['pty-other', 'pty-admin']) {
      expect(
        (await fetch(`${daemon.url}/v1/pty/${foreignId}/scrollback`, { headers: collabHeaders })).status,
      ).toBe(403);
      expect(
        (await fetch(`${daemon.url}/v1/pty/${foreignId}/cwd`, { headers: collabHeaders })).status,
      ).toBe(403);
      expect(
        (await fetch(`${daemon.url}/v1/pty/${foreignId}/stream`, { headers: collabHeaders })).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${daemon.url}/v1/pty/${foreignId}/write`, {
            method: 'POST',
            headers: collabHeaders,
            body: JSON.stringify({ data: 'hijack\n' }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${daemon.url}/v1/pty/${foreignId}/kill`, {
            method: 'POST',
            headers: collabHeaders,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${daemon.url}/v1/pty/spawn`, {
            method: 'POST',
            headers: collabHeaders,
            body: JSON.stringify({ id: foreignId }),
          })
        ).status,
      ).toBe(403);
    }

    // Collaborator cannot spawn a session claiming another workspaceId.
    expect(
      (
        await fetch(`${daemon.url}/v1/pty/spawn`, {
          method: 'POST',
          headers: collabHeaders,
          body: JSON.stringify({ id: 'pty-forged', workspaceId: 'ws-other' }),
        })
      ).status,
    ).toBe(403);
  });

  it('kills running /v1/tools/exec bash child process when the HTTP client aborts', async () => {
    const { daemon, token, root } = await boot();
    const adminHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const pidFile = join(root, 'child.pid');
    const ac = new AbortController();

    const execPromise = fetch(`${daemon.url}/v1/tools/exec`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        tool: 'bash',
        cwd: root,
        input: { command: `echo $$ > "${pidFile}" && exec sleep 30` },
      }),
      signal: ac.signal,
    }).catch(() => undefined);

    // Wait until the spawned bash writes its PID.
    let childPid = 0;
    const startWait = Date.now();
    while (Date.now() - startWait < 3_000) {
      try {
        const raw = (await readFile(pidFile, 'utf8')).trim();
        if (/^\d+$/.test(raw)) {
          childPid = Number(raw);
          break;
        }
      } catch {
        // Not written yet.
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    expect(childPid).toBeGreaterThan(0);

    // Abort the HTTP request and ensure the remote process terminates promptly.
    ac.abort();
    await execPromise;

    let alive = true;
    const killWait = Date.now();
    while (Date.now() - killWait < 4_000) {
      try {
        process.kill(childPid, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
        break;
      }
    }
    if (alive) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
    expect(alive).toBe(false);
  });

  it('streams /v1/tools/exec bash chunks over SSE, tracks share lastUsedAt, and reports onlineClients', async () => {
    const { daemon, token, root } = await boot();
    const adminHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Stream bash tool output via Accept: text/event-stream.
    const streamRes = await fetch(`${daemon.url}/v1/tools/exec`, {
      method: 'POST',
      headers: { ...adminHeaders, Accept: 'text/event-stream' },
      body: JSON.stringify({
        tool: 'bash',
        cwd: root,
        input: { command: 'echo chunk-one && echo chunk-err >&2' },
      }),
    });
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('content-type')).toContain('text/event-stream');
    const ssePayload = await streamRes.text();
    expect(ssePayload).toContain('event: chunk');
    expect(ssePayload).toContain('chunk-one');
    expect(ssePayload).toContain('chunk-err');
    expect(ssePayload).toContain('event: result');

    // Share token usage updates lastUsedAt in GET /v1/shares.
    const shareRes = await fetch(`${daemon.url}/v1/shares`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ workspaceId: 'ws-live-meta', role: 'viewer', label: 'Alex' }),
    });
    const shareBody = (await shareRes.json()) as { share: { id: string; token: string } };
    const beforeList = (await (await fetch(`${daemon.url}/v1/shares?workspaceId=ws-live-meta`, { headers: adminHeaders })).json()) as {
      shares: Array<{ id: string; label?: string; lastUsedAt?: number }>;
    };
    expect(beforeList.shares[0].label).toBe('Alex');
    expect(beforeList.shares[0].lastUsedAt).toBeUndefined();

    // Open an SSE events connection as viewer and verify onlineClients + lastUsedAt.
    const ac = new AbortController();
    const evRes = await fetch(`${daemon.url}/v1/events`, {
      headers: { Authorization: `Bearer ${shareBody.share.token}` },
      signal: ac.signal,
    });
    expect(evRes.status).toBe(200);
    await new Promise((r) => setTimeout(r, 40));

    const metaRes = await fetch(`${daemon.url}/v1/meta?workspaceId=ws-live-meta`, {
      headers: adminHeaders,
    });
    const metaJson = (await metaRes.json()) as { ok: boolean; onlineClients: number };
    expect(metaJson.onlineClients).toBeGreaterThanOrEqual(1);

    const shareMetaRes = await fetch(`${daemon.url}/v1/meta`, {
      headers: { Authorization: `Bearer ${shareBody.share.token}` },
    });
    const shareMetaJson = (await shareMetaRes.json()) as { ok: boolean; shareLabel?: string };
    expect(shareMetaJson.ok).toBe(true);
    expect(shareMetaJson.shareLabel).toBe('Alex');

    const afterList = (await (await fetch(`${daemon.url}/v1/shares?workspaceId=ws-live-meta`, { headers: adminHeaders })).json()) as {
      shares: Array<{ id: string; lastUsedAt?: number }>;
    };
    expect(typeof afterList.shares[0].lastUsedAt).toBe('number');
    ac.abort();

    // Legacy workDir query param works alongside cwd on GET /v1/workspace-doc.
    await mkdir(join(root, 'proj-doc'), { recursive: true });
    await writeFile(join(root, 'proj-doc', 'pulse-workspace.md'), '# Project Doc', 'utf8');
    const docViaCwd = await fetch(
      `${daemon.url}/v1/workspace-doc?cwd=${encodeURIComponent(join(root, 'proj-doc'))}`,
      { headers: adminHeaders },
    );
    expect((await docViaCwd.json()) as { content: string }).toMatchObject({ content: '# Project Doc' });

    const docViaWorkDir = await fetch(
      `${daemon.url}/v1/workspace-doc?workDir=${encodeURIComponent(join(root, 'proj-doc'))}`,
      { headers: adminHeaders },
    );
    expect((await docViaWorkDir.json()) as { content: string }).toMatchObject({ content: '# Project Doc' });
  });

  it('tracks workspace-scoped presence peers with activeNodeId, viewport, and clean removal', async () => {
    const { daemon, token } = await boot();
    const adminHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const shareRes = await fetch(`${daemon.url}/v1/shares`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ workspaceId: 'ws-presence', role: 'editor', label: 'Alex' }),
    });
    const { share } = (await shareRes.json()) as { share: { token: string } };
    const shareHeaders = { Authorization: `Bearer ${share.token}`, 'Content-Type': 'application/json' };

    // Admin publishes presence on ws-presence.
    const ownerUpsert = await fetch(`${daemon.url}/v1/presence`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        workspaceId: 'ws-presence',
        clientId: 'owner-1',
        name: 'Huabang',
        activeNodeId: 'node-a',
        viewport: { x: 100, y: 200, scale: 1.2 },
      }),
    });
    expect(ownerUpsert.status).toBe(200);

    // Scoped share guest publishes presence without needing to supply name (falls back to share label).
    const guestUpsert = await fetch(`${daemon.url}/v1/presence`, {
      method: 'POST',
      headers: shareHeaders,
      body: JSON.stringify({
        clientId: 'guest-1',
        activeNodeId: 'node-b',
      }),
    });
    expect(guestUpsert.status).toBe(200);
    const guestJson = (await guestUpsert.json()) as {
      ok: boolean;
      peers: Array<{ clientId: string; name: string; role: string; activeNodeId?: string; viewport?: { x: number; y: number; scale: number } }>;
    };
    expect(guestJson.ok).toBe(true);
    expect(guestJson.peers).toHaveLength(2);
    expect(guestJson.peers.find((p) => p.clientId === 'guest-1')).toMatchObject({
      name: 'Alex',
      role: 'editor',
      activeNodeId: 'node-b',
    });
    expect(guestJson.peers.find((p) => p.clientId === 'owner-1')).toMatchObject({
      name: 'Huabang',
      role: 'admin',
      activeNodeId: 'node-a',
      viewport: { x: 100, y: 200, scale: 1.2 },
    });

    // Cross-workspace presence access with scoped share token is rejected.
    const crossWs = await fetch(`${daemon.url}/v1/presence?workspaceId=ws-other`, {
      headers: shareHeaders,
    });
    expect(crossWs.status).toBe(400);

    // Guest leaves cleanly.
    const leaveRes = await fetch(`${daemon.url}/v1/presence/guest-1`, {
      method: 'DELETE',
      headers: shareHeaders,
    });
    expect(leaveRes.status).toBe(200);

    const afterLeave = (await (
      await fetch(`${daemon.url}/v1/presence?workspaceId=ws-presence`, { headers: adminHeaders })
    ).json()) as { ok: boolean; peers: Array<{ clientId: string }> };
    expect(afterLeave.peers.map((p) => p.clientId)).toEqual(['owner-1']);
  });

  it('coordinates shared chat-room turns, FIFO queue, stream updates, and viewer 403', async () => {
    const { daemon, token } = await boot();
    const adminHeaders = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const editorShare = (await (
      await fetch(`${daemon.url}/v1/shares`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ workspaceId: 'ws-room', role: 'editor', label: 'Bob' }),
      })
    ).json()) as { ok: boolean; share: { token: string } };
    const viewerShare = (await (
      await fetch(`${daemon.url}/v1/shares`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ workspaceId: 'ws-room', role: 'viewer', label: 'Eve' }),
      })
    ).json()) as { ok: boolean; share: { token: string } };

    const editorHeaders = {
      Authorization: `Bearer ${editorShare.share.token}`,
      'Content-Type': 'application/json',
    };
    const viewerHeaders = {
      Authorization: `Bearer ${viewerShare.share.token}`,
      'Content-Type': 'application/json',
    };

    // Viewer cannot enqueue messages.
    const viewerRes = await fetch(`${daemon.url}/v1/chat-room/enqueue`, {
      method: 'POST',
      headers: viewerHeaders,
      body: JSON.stringify({ conversationId: 'conv-1', clientId: 'eve-1', message: 'hi' }),
    });
    expect(viewerRes.status).toBe(403);

    // Owner enqueues when idle -> immediately claims activeTurn.
    const first = (await (
      await fetch(`${daemon.url}/v1/chat-room/enqueue`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          workspaceId: 'ws-room',
          conversationId: 'conv-1',
          clientId: 'alice-1',
          senderName: 'Alice',
          message: 'first question',
        }),
      })
    ).json()) as { ok: boolean; claimed: boolean; snapshot: { activeTurn: { clientId: string; senderName: string } | null; queue: unknown[] } };
    expect(first.ok).toBe(true);
    expect(first.claimed).toBe(true);
    expect(first.snapshot.activeTurn).toMatchObject({
      clientId: 'alice-1',
      senderName: 'Alice',
      prompt: 'first question',
    });

    // Bob enqueues while Alice holds the turn -> queued in FIFO order.
    const second = (await (
      await fetch(`${daemon.url}/v1/chat-room/enqueue`, {
        method: 'POST',
        headers: editorHeaders,
        body: JSON.stringify({
          conversationId: 'conv-1',
          clientId: 'bob-1',
          message: 'follow up from Bob',
        }),
      })
    ).json()) as { ok: boolean; claimed: boolean; queuedItem: { id: string; senderName: string }; snapshot: { queue: Array<{ id: string; senderName: string }> } };
    expect(second.ok).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.queuedItem.senderName).toBe('Bob');
    expect(second.snapshot.queue).toHaveLength(1);

    // Alice streams text updates.
    const streamed = (await (
      await fetch(`${daemon.url}/v1/chat-room/stream`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          workspaceId: 'ws-room',
          conversationId: 'conv-1',
          clientId: 'alice-1',
          senderName: 'Alice',
          text: 'Working on it...',
        }),
      })
    ).json()) as { ok: boolean; snapshot: { activeTurn: { text: string } | null } };
    expect(streamed.snapshot.activeTurn?.text).toBe('Working on it...');

    // Alice releases turn -> Bob claims and pops his queued message.
    const released = (await (
      await fetch(`${daemon.url}/v1/chat-room/release`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          workspaceId: 'ws-room',
          conversationId: 'conv-1',
          clientId: 'alice-1',
        }),
      })
    ).json()) as { ok: boolean; snapshot: { activeTurn: unknown; turnEnded?: boolean; queue: unknown[] } };
    expect(released.snapshot.activeTurn).toBeNull();
    expect(released.snapshot.turnEnded).toBe(true);
    expect(released.snapshot.queue).toHaveLength(1);

    const bobClaim = (await (
      await fetch(`${daemon.url}/v1/chat-room/claim`, {
        method: 'POST',
        headers: editorHeaders,
        body: JSON.stringify({
          conversationId: 'conv-1',
          clientId: 'bob-1',
          popNext: true,
        }),
      })
    ).json()) as { ok: boolean; claimed: boolean; nextItem?: { message: string }; snapshot: { queue: unknown[] } };
    expect(bobClaim.claimed).toBe(true);
    expect(bobClaim.nextItem?.message).toBe('follow up from Bob');
    expect(bobClaim.snapshot.queue).toHaveLength(0);
  });
});

