import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
});
