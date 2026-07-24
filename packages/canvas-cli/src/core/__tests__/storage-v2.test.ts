import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  detectSchemaVersion,
  isSafeNodeId,
  assembleV2,
  splitV2,
  readNodeFile,
  writeNodeFile,
  deleteNodeFile,
  listNodeFiles,
  getNodeFilePath,
  getNodesDir,
  PER_NODE_SCHEMA_VERSION,
  CANVAS_SCHEMA_VERSION_V2,
  type PerNodeFile,
} from '../storage-v2';
import { loadCanvas, saveCanvas, getWorkspaceDir } from '../store';
import type { CanvasSaveData } from '../types';

let testDir: string;
const wsId = 'ws-v2-test';

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `canvas-cli-v2-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('detectSchemaVersion', () => {
  it('treats missing schemaVersion as v1', () => {
    expect(detectSchemaVersion({ nodes: [] })).toBe(1);
  });
  it('treats schemaVersion=2 as v2', () => {
    expect(detectSchemaVersion({ schemaVersion: 2, nodes: [] })).toBe(2);
  });
  it('treats unknown values as v1 (forward-tolerant)', () => {
    expect(detectSchemaVersion({ schemaVersion: 'wat' })).toBe(1);
    expect(detectSchemaVersion(null)).toBe(1);
  });
});

describe('isSafeNodeId', () => {
  it('allows realistic node ids', () => {
    expect(isSafeNodeId('node-1729-42')).toBe(true);
    expect(isSafeNodeId('n_abc.def')).toBe(true);
  });
  it('rejects traversal and separators', () => {
    expect(isSafeNodeId('../etc/passwd')).toBe(false);
    expect(isSafeNodeId('a/b')).toBe(false);
    expect(isSafeNodeId('..')).toBe(false);
    expect(isSafeNodeId('')).toBe(false);
  });
});

describe('per-node I/O', () => {
  it('round-trips a per-node file', async () => {
    const wsDir = join(testDir, wsId);
    const file: PerNodeFile = {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: 'n1',
      type: 'text',
      title: 'Hello',
      data: { content: 'hi' },
      updatedAt: 1,
      createdAt: 1,
    };
    await writeNodeFile(wsDir, file);
    expect(await readNodeFile(wsDir, 'n1')).toEqual(file);
  });

  it('refuses unsafe node ids on write', async () => {
    const wsDir = join(testDir, wsId);
    expect(() => getNodeFilePath(wsDir, '../escape')).toThrow();
  });

  it('listNodeFiles returns parseable ids only', async () => {
    const wsDir = join(testDir, wsId);
    await writeNodeFile(wsDir, {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: 'a',
      type: 'text',
      data: {},
    });
    await fs.writeFile(join(getNodesDir(wsDir), 'README.txt'), 'noise');
    expect(await listNodeFiles(wsDir)).toEqual(['a']);
  });
});

describe('assembleV2', () => {
  it('merges per-node data back into v1-shape', async () => {
    const wsDir = join(testDir, wsId);
    await writeNodeFile(wsDir, {
      schemaVersion: 1,
      id: 'n1',
      type: 'text',
      title: 'Title',
      data: { content: 'real' },
    });

    const layout: CanvasSaveData = {
      schemaVersion: 2,
      nodes: [
        {
          id: 'n1',
          type: 'text',
          title: 'Stale Layout Title',
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          data: {},
        },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '',
    };

    const out = await assembleV2(wsDir, layout);
    expect(out.schemaVersion).toBeUndefined();
    expect(out.nodes[0].data.content).toBe('real');
    expect(out.nodes[0].title).toBe('Title'); // per-node wins
  });

  it('falls back to empty data when per-node file is missing', async () => {
    const wsDir = join(testDir, wsId);
    const layout: CanvasSaveData = {
      schemaVersion: 2,
      nodes: [{ id: 'orphan', type: 'text', title: 't', x: 0, y: 0, width: 1, height: 1, data: {} }],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '',
    };
    const out = await assembleV2(wsDir, layout);
    expect(out.nodes[0].data).toEqual({});
  });

  it('keeps layout-only reference nodes intact without a per-node file', async () => {
    const wsDir = join(testDir, wsId);
    const layout: CanvasSaveData = {
      schemaVersion: 2,
      nodes: [
        {
          id: 'ref-1',
          type: 'reference',
          title: 'Ref: Hello',
          x: 0,
          y: 0,
          width: 420,
          height: 300,
          ref: { kind: 'workspace-node', workspaceId: 'source-ws', nodeId: 'source-node' },
          data: { titleSnapshot: 'Hello' },
        },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '',
    };
    const out = await assembleV2(wsDir, layout);
    expect(out.nodes[0].data.titleSnapshot).toBe('Hello');
    expect(out.nodes[0].ref).toEqual({ kind: 'workspace-node', workspaceId: 'source-ws', nodeId: 'source-node' });
  });
});

describe('splitV2', () => {
  it('strips data into per-node files + builds v2 layout', async () => {
    const wsDir = join(testDir, wsId);
    const input: CanvasSaveData = {
      nodes: [
        {
          id: 'n1',
          type: 'text',
          title: 'A',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          data: { content: 'A-body' },
          updatedAt: 100,
        },
        {
          id: 'n2',
          type: 'file',
          title: 'B',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          data: { content: 'B-body' },
          updatedAt: 100,
        },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '',
    };
    const layout = await splitV2(wsDir, input);

    expect(layout.schemaVersion).toBe(CANVAS_SCHEMA_VERSION_V2);
    // Split removes `data` from layout entries entirely (destructuring).
    expect((layout.nodes[0] as { data?: unknown }).data).toBeUndefined();

    const n1 = await readNodeFile(wsDir, 'n1');
    expect(n1?.data.content).toBe('A-body');
  });

  it('keeps reference nodes in layout and does not create copied per-node files', async () => {
    const wsDir = join(testDir, wsId);
    const input: CanvasSaveData = {
      nodes: [
        {
          id: 'ref-1',
          type: 'reference',
          title: 'Ref: Hello',
          x: 0,
          y: 0,
          width: 420,
          height: 300,
          ref: { kind: 'workspace-node', workspaceId: 'source-ws', nodeId: 'source-node' },
          data: { titleSnapshot: 'Hello' },
          updatedAt: 100,
        },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '',
    };
    const layout = await splitV2(wsDir, input);

    expect(layout.nodes[0].ref).toEqual({ kind: 'workspace-node', workspaceId: 'source-ws', nodeId: 'source-node' });
    expect(layout.nodes[0].data.titleSnapshot).toBe('Hello');
    expect(await readNodeFile(wsDir, 'ref-1')).toBeNull();
  });

  it('keeps unknown per-node files by default (concurrent-writer protection)', async () => {
    const wsDir = join(testDir, wsId);
    // Simulates a node another process created after this writer loaded its
    // snapshot: it is on disk but absent from the incoming nodes. The old
    // full-sync sweep deleted it — the concurrent-loss incident.
    await writeNodeFile(wsDir, {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: 'concurrent',
      type: 'text',
      data: { content: 'created by another writer' },
    });
    const input: CanvasSaveData = {
      nodes: [
        { id: 'survivor', type: 'text', title: '', x: 0, y: 0, width: 1, height: 1, data: { content: 'kept' } },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '',
    };
    await splitV2(wsDir, input);
    expect(await readNodeFile(wsDir, 'concurrent')).not.toBeNull();
    expect(await readNodeFile(wsDir, 'survivor')).not.toBeNull();
  });

  it('deletes exactly the per-node files named in removedIds', async () => {
    const wsDir = join(testDir, wsId);
    for (const id of ['removed', 'unrelated']) {
      await writeNodeFile(wsDir, {
        schemaVersion: PER_NODE_SCHEMA_VERSION,
        id,
        type: 'text',
        data: { content: id },
      });
    }
    const input: CanvasSaveData = {
      nodes: [
        { id: 'survivor', type: 'text', title: '', x: 0, y: 0, width: 1, height: 1, data: { content: 'kept' } },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '',
    };
    await splitV2(wsDir, input, { removedIds: ['removed'] });
    expect(await readNodeFile(wsDir, 'removed')).toBeNull();
    expect(await readNodeFile(wsDir, 'unrelated')).not.toBeNull();
    expect(await readNodeFile(wsDir, 'survivor')).not.toBeNull();
  });

  it('prunes unknown per-node files only with pruneUnknownNodeFiles (restore/repair path)', async () => {
    const wsDir = join(testDir, wsId);
    await writeNodeFile(wsDir, {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: 'orphan',
      type: 'text',
      data: { content: 'will be gone' },
    });
    const input: CanvasSaveData = {
      nodes: [
        { id: 'survivor', type: 'text', title: '', x: 0, y: 0, width: 1, height: 1, data: { content: 'kept' } },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '',
    };
    await splitV2(wsDir, input, { pruneUnknownNodeFiles: true });
    expect(await readNodeFile(wsDir, 'orphan')).toBeNull();
    expect(await readNodeFile(wsDir, 'survivor')).not.toBeNull();
  });

  it('respects updatedAt arbitration (disk newer than memory)', async () => {
    const wsDir = join(testDir, wsId);
    await writeNodeFile(wsDir, {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: 'n1',
      type: 'text',
      title: '',
      data: { content: 'NEWER ON DISK' },
      updatedAt: 9999,
    });
    const stale: CanvasSaveData = {
      nodes: [
        {
          id: 'n1',
          type: 'text',
          title: '',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          data: { content: 'STALE' },
          updatedAt: 1,
        },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '',
    };
    await splitV2(wsDir, stale);
    const n1 = await readNodeFile(wsDir, 'n1');
    expect(n1?.data.content).toBe('NEWER ON DISK');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end through store.ts loadCanvas / saveCanvas

describe('store.loadCanvas + saveCanvas on v2 workspaces', () => {
  it('loadCanvas returns v1-shape from a v2 workspace', async () => {
    const wsDir = getWorkspaceDir(wsId, testDir);
    await fs.mkdir(wsDir, { recursive: true });
    // Hand-craft a v2 workspace on disk.
    const layout: CanvasSaveData = {
      schemaVersion: 2,
      nodes: [
        {
          id: 'n1',
          type: 'text',
          title: 'Hello',
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          data: {},
        },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '',
    };
    await fs.writeFile(join(wsDir, 'canvas.json'), JSON.stringify(layout));
    await writeNodeFile(wsDir, {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: 'n1',
      type: 'text',
      title: 'Hello',
      data: { content: 'assembled!' },
    });

    const loaded = await loadCanvas(wsId, testDir);
    expect(loaded?.nodes[0].data.content).toBe('assembled!');
    expect(loaded?.schemaVersion).toBeUndefined(); // v1-shape exposed
  });

  it('saveCanvas on a v2 workspace keeps it v2 (splits node.data out)', async () => {
    // Seed v2 on disk.
    const wsDir = getWorkspaceDir(wsId, testDir);
    await fs.mkdir(wsDir, { recursive: true });
    const layout: CanvasSaveData = {
      schemaVersion: 2,
      nodes: [{ id: 'n1', type: 'text', title: '', x: 0, y: 0, width: 1, height: 1, data: {} }],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '',
    };
    await fs.writeFile(join(wsDir, 'canvas.json'), JSON.stringify(layout));
    await writeNodeFile(wsDir, {
      schemaVersion: 1,
      id: 'n1',
      type: 'text',
      data: { content: 'before' },
    });

    // Caller writes v1-shape; saveCanvas should preserve v2 on disk.
    const v1Input: CanvasSaveData = {
      nodes: [
        {
          id: 'n1',
          type: 'text',
          title: '',
          x: 5,
          y: 5,
          width: 1,
          height: 1,
          data: { content: 'after' },
          updatedAt: Date.now(),
        },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: new Date().toISOString(),
    };
    await saveCanvas(wsId, v1Input, testDir, { allowEmpty: true });

    const onDisk = JSON.parse(await fs.readFile(join(wsDir, 'canvas.json'), 'utf-8'));
    expect(onDisk.schemaVersion).toBe(2);
    expect(onDisk.nodes[0].data).toBeUndefined(); // stripped
    const perNode = await readNodeFile(wsDir, 'n1');
    expect(perNode?.data.content).toBe('after');
  });

  it('saveCanvas on a v1 workspace stays v1 (no auto-promotion)', async () => {
    const wsDir = getWorkspaceDir(wsId, testDir);
    await fs.mkdir(wsDir, { recursive: true });
    await fs.writeFile(
      join(wsDir, 'canvas.json'),
      JSON.stringify({
        nodes: [{ id: 'n1', type: 'text', title: '', x: 0, y: 0, width: 1, height: 1, data: { content: 'v1' } }],
        transform: { x: 0, y: 0, scale: 1 },
        savedAt: '',
      }),
    );

    const v1Input: CanvasSaveData = {
      nodes: [
        {
          id: 'n1',
          type: 'text',
          title: '',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          data: { content: 'updated v1' },
        },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '',
    };
    await saveCanvas(wsId, v1Input, testDir, { allowEmpty: true });

    const onDisk = JSON.parse(await fs.readFile(join(wsDir, 'canvas.json'), 'utf-8'));
    expect(onDisk.schemaVersion).toBeUndefined();
    expect(onDisk.nodes[0].data.content).toBe('updated v1');
    // No nodes/ directory should have been created.
    await expect(fs.access(getNodesDir(wsDir))).rejects.toThrow();
    void deleteNodeFile; // appease unused-import check in lint configs
  });
});
