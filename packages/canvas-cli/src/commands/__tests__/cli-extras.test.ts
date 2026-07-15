import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { createCli } from '../../cli';
import { saveCanvas, saveWorkspaceManifest } from '../../core/store';
import { ENV_WORKSPACE_ID } from '../../core/workspace-resolution';
import type { CanvasSaveData } from '../../core/types';

const RUNTIME_FILE = join(homedir(), '.pulse-coder', 'canvas-runtime', 'canvas-workspace.json');

let testDir: string;
let savedEnv: string | undefined;
let runtimeBackup: Buffer | null = null;

async function runCli(argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => { stdout.push(a.map(String).join(' ')); });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => { stderr.push(a.map(String).join(' ')); });
  let exitCode: number | null = null;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`__exit:${code}`);
  }) as never);
  const cli = createCli();
  cli.exitOverride();
  try {
    await cli.parseAsync(argv, { from: 'user' });
  } catch { /* exitCode carries the signal */ }
  logSpy.mockRestore();
  errSpy.mockRestore();
  exitSpy.mockRestore();
  return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode };
}

const canvasWith = (nodes: CanvasSaveData['nodes']): CanvasSaveData => ({
  nodes, transform: { x: 0, y: 0, scale: 1 }, savedAt: '2025-01-01T00:00:00.000Z',
});

beforeEach(async () => {
  testDir = join(tmpdir(), `canvas-cli-extras-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(testDir, { recursive: true });
  savedEnv = process.env[ENV_WORKSPACE_ID];
  delete process.env[ENV_WORKSPACE_ID];
  // Isolate from a real runtime file so `status` is deterministic.
  try { runtimeBackup = await fs.readFile(RUNTIME_FILE); } catch { runtimeBackup = null; }
  await fs.rm(RUNTIME_FILE, { force: true });
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[ENV_WORKSPACE_ID];
  else process.env[ENV_WORKSPACE_ID] = savedEnv;
  if (runtimeBackup) {
    await fs.mkdir(join(homedir(), '.pulse-coder', 'canvas-runtime'), { recursive: true });
    await fs.writeFile(RUNTIME_FILE, runtimeBackup);
  } else {
    await fs.rm(RUNTIME_FILE, { force: true });
  }
  await fs.rm(testDir, { recursive: true, force: true });
});

async function seedActive(id: string, nodes: CanvasSaveData['nodes'] = []): Promise<void> {
  await saveCanvas(id, canvasWith(nodes), testDir, { allowEmpty: true });
  await saveWorkspaceManifest({ workspaces: [{ id, name: 'WS' }], activeId: id }, testDir);
}

describe('node read batch', () => {
  it('returns an array with a per-id error entry for a missing node', async () => {
    await seedActive('ws', [
      { id: 't1', type: 'text', title: 'A', x: 0, y: 0, width: 10, height: 10, data: { content: 'aaa' } },
      { id: 't2', type: 'text', title: 'B', x: 0, y: 0, width: 10, height: 10, data: { content: 'bbb' } },
    ]);
    const { stdout, exitCode } = await runCli(['--store-dir', testDir, '--format', 'json', 'node', 'read', 't1', 't2', 'gone']);
    expect(exitCode).toBe(null);
    const arr = JSON.parse(stdout) as Array<{ id: string; content?: string; error?: string; code?: string }>;
    expect(arr).toHaveLength(3);
    expect(arr[0]).toMatchObject({ id: 't1', content: 'aaa' });
    expect(arr[2]).toMatchObject({ id: 'gone', code: 'node_not_found' });
  });

  it('keeps single-id reads as a bare object', async () => {
    await seedActive('ws', [{ id: 't1', type: 'text', title: 'A', x: 0, y: 0, width: 10, height: 10, data: { content: 'solo' } }]);
    const { stdout } = await runCli(['--store-dir', testDir, '--format', 'json', 'node', 'read', 't1']);
    const obj = JSON.parse(stdout) as { type: string; content: string };
    expect(Array.isArray(obj)).toBe(false);
    expect(obj).toMatchObject({ type: 'text', content: 'solo' });
  });
});

describe('describe', () => {
  it('emits a machine-readable manifest', async () => {
    const { stdout, exitCode } = await runCli(['--format', 'json', 'describe']);
    expect(exitCode).toBe(null);
    const m = JSON.parse(stdout);
    expect(m.describeVersion).toBe(1);
    expect(m.nodeTypes.creatable).toContain('file');
    expect(m.nodeTypes.known).toContain('iframe');
    expect(m.errorCodes).toContain('node_not_found');
    expect(m.commands.map((c: { name: string }) => c.name)).toContain('node');
  });
});

describe('status', () => {
  it('reports store, resolved workspace, and runtime unavailability', async () => {
    await seedActive('ws-a');
    const { stdout, exitCode } = await runCli(['--store-dir', testDir, '--format', 'json', 'status']);
    expect(exitCode).toBe(null);
    const s = JSON.parse(stdout);
    expect(s.activeWorkspaceId).toBe('ws-a');
    expect(s.resolved).toMatchObject({ workspaceId: 'ws-a', source: 'manifest-active' });
    expect(s.runtime.present).toBe(false);
    expect(s.runtime.reachable).toBe(false);
  });

  it('does not exit non-zero when no workspace is selected', async () => {
    const { stdout, exitCode } = await runCli(['--store-dir', testDir, '--format', 'json', 'status']);
    expect(exitCode).toBe(null);
    const s = JSON.parse(stdout);
    expect(s.resolved.workspaceId).toBeNull();
    expect(s.resolved.code).toBe('no_workspace_selected');
  });
});
