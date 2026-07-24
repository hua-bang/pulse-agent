import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  writeNodeFile,
  readNodeFile,
  PER_NODE_SCHEMA_VERSION,
} from '../storage-v2';
import {
  commitNodeMutation,
  withWorkspaceLock,
  getWorkspaceDir,
} from '../store';
import type { CanvasNode, CanvasSaveData } from '../types';

/**
 * Regression tests for the concurrent-write incident: parallel canvas-cli
 * invocations doing full-canvas read-modify-write saves produced tmp-rename
 * ENOENT errors, lost nodes, and orphan-sweep deletion of freshly created
 * per-node files. Guards: unique tmp names in writeNodeFile, the workspace
 * lock around commitNode/EdgeMutation, and opt-in-only orphan pruning.
 */

let testDir: string;
const wsId = 'ws-race-test';

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `canvas-cli-race-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

function textNode(id: string, content: string): CanvasNode {
  return {
    id,
    type: 'text',
    title: id,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    data: { content },
    updatedAt: Date.now(),
  };
}

async function seedV2Workspace(nodes: CanvasNode[]): Promise<string> {
  const wsDir = getWorkspaceDir(wsId, testDir);
  await fs.mkdir(wsDir, { recursive: true });
  const layout: CanvasSaveData = {
    schemaVersion: 2,
    nodes: nodes.map(({ data: _data, ...rest }) => rest as CanvasNode),
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: new Date().toISOString(),
  };
  await fs.writeFile(join(wsDir, 'canvas.json'), JSON.stringify(layout));
  for (const n of nodes) {
    await writeNodeFile(wsDir, {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: n.id,
      type: n.type,
      title: n.title,
      data: n.data,
      updatedAt: n.updatedAt,
    });
  }
  return wsDir;
}

describe('writeNodeFile under concurrency', () => {
  it('parallel writes to the same node never throw on tmp rename', async () => {
    const wsDir = getWorkspaceDir(wsId, testDir);
    // The pre-fix fixed `<path>.tmp` name made concurrent writers rename the
    // same tmp path — most renames threw ENOENT. Unique names must all land.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        writeNodeFile(wsDir, {
          schemaVersion: PER_NODE_SCHEMA_VERSION,
          id: 'contended',
          type: 'text',
          data: { content: `writer-${i}` },
        }),
      ),
    );
    const final = await readNodeFile(wsDir, 'contended');
    expect(final).not.toBeNull();
    expect(String(final?.data.content)).toMatch(/^writer-\d+$/);
    // No tmp litter left behind on the success path.
    const leftovers = (await fs.readdir(join(wsDir, 'nodes'))).filter(f => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});

describe('withWorkspaceLock', () => {
  it('serializes critical sections within one process', async () => {
    const order: string[] = [];
    await Promise.all([
      withWorkspaceLock(wsId, testDir, async () => {
        order.push('a-in');
        await new Promise(r => setTimeout(r, 40));
        order.push('a-out');
      }),
      withWorkspaceLock(wsId, testDir, async () => {
        order.push('b-in');
        order.push('b-out');
      }),
    ]);
    expect(order).toEqual(['a-in', 'a-out', 'b-in', 'b-out']);
  });

  it('times out when another process holds the lock', async () => {
    const lockDir = join(testDir, '__locks__', `${wsId}.lock`);
    await fs.mkdir(lockDir, { recursive: true });
    await expect(
      withWorkspaceLock(wsId, testDir, async () => 'never', {
        staleAfterMs: 60_000,
        timeoutMs: 250,
      }),
    ).rejects.toThrow(/timed out waiting for workspace canvas lock/);
  });

  it('steals a stale lock left by a dead process', async () => {
    const lockDir = join(testDir, '__locks__', `${wsId}.lock`);
    await fs.mkdir(lockDir, { recursive: true });
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(lockDir, past, past);
    const out = await withWorkspaceLock(wsId, testDir, async () => 'ran', {
      staleAfterMs: 1_000,
      timeoutMs: 2_000,
    });
    expect(out).toBe('ran');
  });

  it('releases the lock after the critical section throws', async () => {
    await expect(
      withWorkspaceLock(wsId, testDir, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // A failed predecessor must neither leave the dir lock behind nor wedge
    // the in-process queue.
    const out = await withWorkspaceLock(wsId, testDir, async () => 'recovered', {
      timeoutMs: 500,
    });
    expect(out).toBe('recovered');
  });
});

describe('concurrent commitNodeMutation (the incident scenario)', () => {
  it('parallel creates both survive on a v2 workspace', async () => {
    const wsDir = await seedV2Workspace([textNode('n-existing', 'already here')]);

    await Promise.all([
      commitNodeMutation(wsId, { upsert: textNode('n-a', 'from writer A') }, testDir),
      commitNodeMutation(wsId, { upsert: textNode('n-b', 'from writer B') }, testDir),
    ]);

    const onDisk = JSON.parse(await fs.readFile(join(wsDir, 'canvas.json'), 'utf-8'));
    const ids = (onDisk.nodes as Array<{ id: string }>).map(n => n.id).sort();
    expect(ids).toEqual(['n-a', 'n-b', 'n-existing']);
    // Per-node files: neither writer's file was deleted by the other's sweep.
    expect(await readNodeFile(wsDir, 'n-a')).not.toBeNull();
    expect(await readNodeFile(wsDir, 'n-b')).not.toBeNull();
    expect(await readNodeFile(wsDir, 'n-existing')).not.toBeNull();
  });

  it('explicit removal still deletes the per-node file', async () => {
    const wsDir = await seedV2Workspace([
      textNode('n-keep', 'stays'),
      textNode('n-drop', 'goes'),
    ]);

    const result = await commitNodeMutation(wsId, { removeId: 'n-drop' }, testDir);
    expect(result).not.toBeNull();
    expect(await readNodeFile(wsDir, 'n-drop')).toBeNull();
    expect(await readNodeFile(wsDir, 'n-keep')).not.toBeNull();
    const onDisk = JSON.parse(await fs.readFile(join(wsDir, 'canvas.json'), 'utf-8'));
    expect((onDisk.nodes as Array<{ id: string }>).map(n => n.id)).toEqual(['n-keep']);
  });
});
