import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createCli } from '../../cli';
import { saveCanvas, saveWorkspaceManifest } from '../../core/store';
import { ENV_WORKSPACE_ID } from '../../core/workspace-resolution';
import type { CanvasSaveData } from '../../core/types';

let testDir: string;
let savedEnvWorkspace: string | undefined;

const populatedCanvas: CanvasSaveData = {
  nodes: [
    { id: 'node-1', type: 'file', title: 'Notes', x: 0, y: 0, width: 100, height: 100, data: { content: 'hi' } },
  ],
  transform: { x: 0, y: 0, scale: 1 },
  savedAt: '2025-01-01T00:00:00.000Z',
};

/**
 * Run the real CLI in-process, capturing stdout/stderr and the exit code.
 * Mirrors the harness in agent.test.ts.
 */
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
  } catch {
    // swallow the __exit throw / commander errors — exitCode carries the signal
  }
  logSpy.mockRestore();
  errSpy.mockRestore();
  exitSpy.mockRestore();
  return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode };
}

beforeEach(async () => {
  testDir = join(tmpdir(), `canvas-cli-resolve-cli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(testDir, { recursive: true });
  // Isolate from any real env the test host may carry.
  savedEnvWorkspace = process.env[ENV_WORKSPACE_ID];
  delete process.env[ENV_WORKSPACE_ID];
});

afterEach(async () => {
  if (savedEnvWorkspace === undefined) delete process.env[ENV_WORKSPACE_ID];
  else process.env[ENV_WORKSPACE_ID] = savedEnvWorkspace;
  await fs.rm(testDir, { recursive: true, force: true });
});

async function seedActiveWorkspace(id: string): Promise<void> {
  await saveCanvas(id, populatedCanvas, testDir);
  await saveWorkspaceManifest(
    { workspaces: [{ id, name: 'Active WS' }], activeId: id },
    testDir,
  );
}

describe('workspace auto-discovery for disk commands', () => {
  it('`context` succeeds without -w by using the active workspace', async () => {
    await seedActiveWorkspace('ws-active');
    const { stdout, exitCode } = await runCli(['--store-dir', testDir, '--format', 'json', 'context']);
    expect(exitCode).toBe(null);
    const ctx = JSON.parse(stdout) as { workspaceId?: string };
    expect(ctx.workspaceId).toBe('ws-active');
  });

  it('`node list` succeeds without -w by using the active workspace', async () => {
    await seedActiveWorkspace('ws-active');
    const { stdout, exitCode } = await runCli(['--store-dir', testDir, '--format', 'json', 'node', 'list']);
    expect(exitCode).toBe(null);
    const rows = JSON.parse(stdout) as Array<{ id: string }>;
    expect(rows.map(r => r.id)).toEqual(['node-1']);
  });

  it('errors with a selection hint when nothing selects a workspace', async () => {
    const { stderr, exitCode } = await runCli(['--store-dir', testDir, 'node', 'list']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/No workspace selected/);
  });

  it('honors an explicit -w over the active workspace', async () => {
    await seedActiveWorkspace('ws-active');
    await saveCanvas('ws-other', populatedCanvas, testDir);
    const { stdout, exitCode } = await runCli([
      '--store-dir', testDir, '--format', 'json', '-w', 'ws-other', 'context',
    ]);
    expect(exitCode).toBe(null);
    expect((JSON.parse(stdout) as { workspaceId?: string }).workspaceId).toBe('ws-other');
  });
});

describe('workspace current', () => {
  it('reports the resolved workspace, its active flag, and the source', async () => {
    await seedActiveWorkspace('ws-active');
    const { stdout, exitCode } = await runCli(['--store-dir', testDir, '--format', 'json', 'workspace', 'current']);
    expect(exitCode).toBe(null);
    expect(JSON.parse(stdout)).toEqual({
      id: 'ws-active',
      name: 'Active WS',
      active: true,
      source: 'manifest-active',
    });
  });

  it('marks the source as explicit when -w is passed', async () => {
    await seedActiveWorkspace('ws-active');
    await saveCanvas('ws-other', populatedCanvas, testDir);
    const { stdout, exitCode } = await runCli([
      '--store-dir', testDir, '--format', 'json', '-w', 'ws-other', 'workspace', 'current',
    ]);
    expect(exitCode).toBe(null);
    expect(JSON.parse(stdout)).toMatchObject({ id: 'ws-other', active: false, source: 'explicit' });
  });
});

describe('workspace list', () => {
  it('flags the active workspace', async () => {
    await seedActiveWorkspace('ws-active');
    await saveCanvas('ws-idle', populatedCanvas, testDir);
    const { stdout, exitCode } = await runCli(['--store-dir', testDir, '--format', 'json', 'workspace', 'list']);
    expect(exitCode).toBe(null);
    const rows = JSON.parse(stdout) as Array<{ id: string; active: boolean }>;
    const active = rows.find(r => r.active);
    expect(active?.id).toBe('ws-active');
    expect(rows.filter(r => r.active)).toHaveLength(1);
  });
});
