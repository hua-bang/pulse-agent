import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Command } from 'commander';
import { registerRestoreCommand } from '../restore';
import { getWorkspaceDir } from '../../core/store';
import {
  writeNodeFile,
  PER_NODE_SCHEMA_VERSION,
} from '../../core/storage-v2';

// Each test gets its own canvas store root so the storeDir flag isolates
// them from the user's real `~/.pulse-coder/canvas/`.
let testRoot: string;
const wsId = 'ws-restore-test';

function buildCli(): Command {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit on errors
  program
    .option('--format <format>', 'Output format: json or text', 'text')
    .option('--store-dir <path>', 'Canvas store directory')
    .option('-w, --workspace <id>', 'Workspace id');
  registerRestoreCommand(program);
  return program;
}

beforeEach(async () => {
  testRoot = join(
    tmpdir(),
    `canvas-cli-restore-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  await fs.mkdir(join(testRoot, wsId), { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(testRoot, { recursive: true, force: true });
});

const consoleLogs = (): string[] => {
  const calls = (console.log as unknown as { mock?: { calls: unknown[][] } }).mock?.calls ?? [];
  return calls.map((c) => String(c[0] ?? ''));
};

const consoleErrors = (): string[] => {
  const calls = (console.error as unknown as { mock?: { calls: unknown[][] } }).mock?.calls ?? [];
  return calls.map((c) => String(c[0] ?? ''));
};

// ─────────────────────────────────────────────────────────────────────────────
// restore list

describe('restore list', () => {
  it('reports "no snapshots" for a fresh workspace', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const cli = buildCli();
    await cli.parseAsync(
      ['node', 'pulse-canvas', '--store-dir', testRoot, 'restore', 'list', wsId],
    );
    expect(consoleLogs().join('\n')).toMatch(/No v1 snapshots found/);
  });

  it('lists the stable alias and every timestamped archive, newest first', async () => {
    const wsDir = getWorkspaceDir(wsId, testRoot);
    // Stable alias
    await fs.writeFile(
      join(wsDir, 'canvas.json.v1.bak'),
      JSON.stringify({
        nodes: [{ id: 'a', type: 'text', title: 'A', x: 0, y: 0, width: 10, height: 10, data: { content: '1' } }],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );
    // Two timestamped archives (older + newer)
    await fs.writeFile(
      join(wsDir, 'canvas.json.v1.2026-05-25T09-30-42-123Z.bak'),
      JSON.stringify({
        nodes: [{ id: 'a', type: 'text', title: 'A', x: 0, y: 0, width: 10, height: 10, data: { content: '1' } }],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );
    await fs.writeFile(
      join(wsDir, 'canvas.json.v1.2025-01-01T00-00-00-000Z.bak'),
      JSON.stringify({
        nodes: [],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const cli = buildCli();
    await cli.parseAsync([
      'node',
      'pulse-canvas',
      '--store-dir',
      testRoot,
      '--format',
      'json',
      'restore',
      'list',
      wsId,
    ]);

    const payload = JSON.parse(consoleLogs()[0]) as Array<{ filename: string; isStableAlias: boolean; isoTimestamp: string | null }>;
    expect(payload).toHaveLength(3);
    // Stable alias surfaces first regardless of mtime — it's the
    // documented "latest known good" pointer.
    expect(payload[0].isStableAlias).toBe(true);
    expect(payload[0].filename).toBe('canvas.json.v1.bak');
    // Among timestamped archives, the newer one comes first.
    expect(payload[1].isoTimestamp).toBe('2026-05-25T09:30:42.123Z');
    expect(payload[2].isoTimestamp).toBe('2025-01-01T00:00:00.000Z');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// restore apply --dry-run

describe('restore apply --dry-run', () => {
  it('shows the plan but writes nothing', async () => {
    const wsDir = getWorkspaceDir(wsId, testRoot);
    // Current state: v2 (the post-pollution-aware-migration scenario,
    // i.e., what the user typically restores away from)
    await fs.writeFile(
      join(wsDir, 'canvas.json'),
      JSON.stringify({
        schemaVersion: 2,
        nodes: [{ id: 'a', type: 'text', title: 'A', x: 0, y: 0, width: 10, height: 10 }],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );
    await writeNodeFile(wsDir, {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: 'a',
      type: 'text',
      title: 'A',
      data: { content: 'empty-after-pollution' },
    });

    // Source: a v1 snapshot we want to roll back to.
    const sourcePath = join(testRoot, 'snapshot.json');
    await fs.writeFile(
      sourcePath,
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', title: 'A', x: 0, y: 0, width: 10, height: 10, data: { content: 'real-data' } },
        ],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const cli = buildCli();
    await cli.parseAsync([
      'node',
      'pulse-canvas',
      '--store-dir',
      testRoot,
      'restore',
      'apply',
      wsId,
      '--from',
      sourcePath,
      '--dry-run',
    ]);

    const out = consoleLogs().join('\n');
    expect(out).toMatch(/DRY RUN/);
    expect(out).toContain('1 nodes, v1 shape');
    expect(out).toMatch(/canvas\.json\.pre-restore\..+\.bak/);
    expect(out).toMatch(/nodes\.pre-restore\./);

    // canvas.json wasn't touched.
    const after = JSON.parse(await fs.readFile(join(wsDir, 'canvas.json'), 'utf-8'));
    expect(after.schemaVersion).toBe(2);
    // No backup files created.
    const entries = await fs.readdir(wsDir);
    expect(entries.some((e) => e.startsWith('canvas.json.pre-restore.'))).toBe(false);
    expect(entries.some((e) => e.startsWith('nodes.pre-restore.'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// restore apply --yes

describe('restore apply --yes', () => {
  async function setupPollutedWorkspace(): Promise<{ sourcePath: string; wsDir: string }> {
    const wsDir = getWorkspaceDir(wsId, testRoot);
    // The pollution shape: v2 canvas.json with empty per-node data
    // (what the user lands on after the bad-migration scenario the
    // pollution guard now prevents).
    await fs.writeFile(
      join(wsDir, 'canvas.json'),
      JSON.stringify({
        schemaVersion: 2,
        nodes: [{ id: 'a', type: 'text', title: 'A', x: 0, y: 0, width: 10, height: 10 }],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );
    await writeNodeFile(wsDir, {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: 'a',
      type: 'text',
      title: 'A',
      data: {},
    });

    // Source: a clean v1 snapshot with the real data.
    const sourcePath = join(testRoot, 'good-snapshot.json');
    await fs.writeFile(
      sourcePath,
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', title: 'A', x: 0, y: 0, width: 10, height: 10, data: { content: 'rescued' } },
        ],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );
    return { sourcePath, wsDir };
  }

  it('writes the source bytes verbatim, backs up canvas.json, archives nodes/', async () => {
    const { sourcePath, wsDir } = await setupPollutedWorkspace();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const cli = buildCli();
    await cli.parseAsync([
      'node',
      'pulse-canvas',
      '--store-dir',
      testRoot,
      'restore',
      'apply',
      wsId,
      '--from',
      sourcePath,
      '--yes',
    ]);

    // canvas.json is now the v1 snapshot.
    const after = JSON.parse(await fs.readFile(join(wsDir, 'canvas.json'), 'utf-8'));
    expect(after.schemaVersion).toBeUndefined();
    expect(after.nodes[0].data.content).toBe('rescued');

    // Backup exists with the previous (v2 layout) content.
    const entries = await fs.readdir(wsDir);
    const backup = entries.find((e) => e.startsWith('canvas.json.pre-restore.') && e.endsWith('.bak'));
    expect(backup).toBeTruthy();
    const backupContent = JSON.parse(await fs.readFile(join(wsDir, backup!), 'utf-8'));
    expect(backupContent.schemaVersion).toBe(2);

    // nodes/ was renamed away.
    const archive = entries.find((e) => e.startsWith('nodes.pre-restore.'));
    expect(archive).toBeTruthy();
    const archived = await fs.readdir(join(wsDir, archive!));
    expect(archived).toContain('a.json');
    // And the live nodes/ no longer exists.
    await expect(fs.access(join(wsDir, 'nodes'))).rejects.toThrow();
  });

  it('removes a stale .migrating sentinel', async () => {
    const { sourcePath, wsDir } = await setupPollutedWorkspace();
    await fs.writeFile(
      join(wsDir, '.migrating'),
      JSON.stringify({ startedAt: 0, workspaceId: wsId, sourceUpdatedAt: null, expectedNodeIds: [] }),
    );
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const cli = buildCli();
    await cli.parseAsync([
      'node',
      'pulse-canvas',
      '--store-dir',
      testRoot,
      'restore',
      'apply',
      wsId,
      '--from',
      sourcePath,
      '--yes',
    ]);

    await expect(fs.access(join(wsDir, '.migrating'))).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// restore apply rejects bad inputs

describe('restore apply input validation', () => {
  it('rejects a v2 source (would empty out data)', async () => {
    const sourcePath = join(testRoot, 'v2-source.json');
    await fs.writeFile(
      sourcePath,
      JSON.stringify({
        schemaVersion: 2,
        nodes: [{ id: 'a', type: 'text', title: 'A', x: 0, y: 0, width: 10, height: 10 }],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__exit');
    }) as never);

    const cli = buildCli();
    await expect(
      cli.parseAsync([
        'node',
        'pulse-canvas',
        '--store-dir',
        testRoot,
        'restore',
        'apply',
        wsId,
        '--from',
        sourcePath,
        '--yes',
      ]),
    ).rejects.toThrow();

    expect(consoleErrors().join('\n')).toMatch(/schemaVersion === 2/);
    expect(exitSpy).toHaveBeenCalled();
  });

  it('rejects a source without a nodes array', async () => {
    const sourcePath = join(testRoot, 'no-nodes.json');
    await fs.writeFile(sourcePath, JSON.stringify({ transform: { x: 0, y: 0, scale: 1 } }));

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__exit');
    }) as never);

    const cli = buildCli();
    await expect(
      cli.parseAsync([
        'node',
        'pulse-canvas',
        '--store-dir',
        testRoot,
        'restore',
        'apply',
        wsId,
        '--from',
        sourcePath,
        '--yes',
      ]),
    ).rejects.toThrow();

    expect(consoleErrors().join('\n')).toMatch(/no `nodes` array/);
  });
});
