import { mkdtemp, rm } from 'node:fs/promises';
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
    const { daemon, token } = await boot();
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
  });
});
