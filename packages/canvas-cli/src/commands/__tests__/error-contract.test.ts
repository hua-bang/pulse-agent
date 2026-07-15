import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createCli } from '../../cli';
import { saveCanvas, saveWorkspaceManifest } from '../../core/store';
import { ENV_WORKSPACE_ID } from '../../core/workspace-resolution';
import type { CanvasSaveData } from '../../core/types';

let testDir: string;
let savedEnv: string | undefined;

const canvasWith = (nodes: CanvasSaveData['nodes']): CanvasSaveData => ({
  nodes,
  transform: { x: 0, y: 0, scale: 1 },
  savedAt: '2025-01-01T00:00:00.000Z',
});

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
  } catch { /* __exit / commander errors carried via exitCode */ }
  logSpy.mockRestore();
  errSpy.mockRestore();
  exitSpy.mockRestore();
  return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode };
}

beforeEach(async () => {
  testDir = join(tmpdir(), `canvas-cli-errc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(testDir, { recursive: true });
  savedEnv = process.env[ENV_WORKSPACE_ID];
  delete process.env[ENV_WORKSPACE_ID];
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[ENV_WORKSPACE_ID];
  else process.env[ENV_WORKSPACE_ID] = savedEnv;
  await fs.rm(testDir, { recursive: true, force: true });
});

async function seedActive(id: string, nodes: CanvasSaveData['nodes'] = []): Promise<void> {
  await saveCanvas(id, canvasWith(nodes), testDir, { allowEmpty: true });
  await saveWorkspaceManifest({ workspaces: [{ id, name: 'WS' }], activeId: id }, testDir);
}

describe('structured JSON error contract', () => {
  it('emits {ok:false,error,code} on stderr in --format json (no workspace selected)', async () => {
    const { stderr, stdout, exitCode } = await runCli(['--store-dir', testDir, '--format', 'json', 'node', 'list']);
    expect(exitCode).toBe(1);
    expect(stdout).toBe(''); // stdout stays clean
    const parsed = JSON.parse(stderr);
    expect(parsed).toMatchObject({ ok: false, code: 'no_workspace_selected' });
    expect(typeof parsed.error).toBe('string');
  });

  it('uses code node_not_found for a missing node', async () => {
    await seedActive('ws-a');
    const { stderr, exitCode } = await runCli(['--store-dir', testDir, '--format', 'json', 'node', 'read', 'nope']);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr)).toMatchObject({ ok: false, code: 'node_not_found' });
  });

  it('uses code workspace_not_found when an explicit workspace is absent', async () => {
    const { stderr } = await runCli(['--store-dir', testDir, '--format', 'json', '-w', 'ghost', 'node', 'list']);
    expect(JSON.parse(stderr)).toMatchObject({ ok: false, code: 'workspace_not_found' });
  });

  it('reports invalid_argument for a bad node type on create', async () => {
    await seedActive('ws-a');
    const { stderr } = await runCli(['--store-dir', testDir, '--format', 'json', 'node', 'create', '--type', 'bogus']);
    expect(JSON.parse(stderr)).toMatchObject({ ok: false, code: 'invalid_argument' });
  });

  it('stays human-readable (not JSON) in text mode', async () => {
    const { stderr, exitCode } = await runCli(['--store-dir', testDir, 'node', 'list']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/^Error: /);
    expect(() => JSON.parse(stderr)).toThrow();
  });
});

describe('--confine-to-workspace via the CLI', () => {
  it('refuses node write to a file node whose path escapes the workspace', async () => {
    const outside = join(testDir, 'victim.txt');
    await fs.writeFile(outside, 'original', 'utf-8');
    await seedActive('ws-a', [
      { id: 'f1', type: 'file', title: 'F', x: 0, y: 0, width: 100, height: 100, data: { filePath: outside, content: '' } },
    ]);

    const { stderr, exitCode } = await runCli([
      '--store-dir', testDir, '--format', 'json', '--confine-to-workspace',
      'node', 'write', 'f1', '--content', 'HACKED',
    ]);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr)).toMatchObject({ ok: false, code: 'path_confined' });
    expect(await fs.readFile(outside, 'utf-8')).toBe('original');
  });
});
