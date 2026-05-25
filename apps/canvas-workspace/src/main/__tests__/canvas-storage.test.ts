import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  atomicWriteJson,
  readJsonWithRecovery,
  detectSchemaVersion,
  isSafeNodeId,
  getCanvasJsonPath,
  getNodeFilePath,
  getNodesDir,
  getV1BackupPath,
  getV1TimestampedBackupPath,
  getSentinelPath,
  getWorkspaceDir,
  scanForPollutedWorkspaces,
  readNodeFile,
  writeNodeFile,
  deleteNodeFile,
  listNodeFiles,
  readCanvasFull,
  writeCanvasFull,
  migrateToV2,
  recoverInterruptedMigration,
  writeSentinel,
  readSentinel,
  markMigrationActive,
  clearMigrationActive,
  detectV1Pollution,
  CanvasPollutionDetectedError,
  CANVAS_SCHEMA_VERSION_V2,
  PER_NODE_SCHEMA_VERSION,
  type CanvasSaveData,
  type MigrationProgress,
  type PerNodeFile,
} from '../canvas-storage';

let root: string;
const wsId = 'ws-test';

beforeEach(async () => {
  root = join(
    tmpdir(),
    `canvas-storage-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await fs.mkdir(root, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Atomic I/O

describe('atomicWriteJson', () => {
  it('writes the file and creates parent dirs', async () => {
    const path = join(root, 'deep', 'nested', 'file.json');
    await atomicWriteJson(path, '{"x":1}');
    expect(await fs.readFile(path, 'utf-8')).toBe('{"x":1}');
  });

  it('publishes via rename — no stray .tmp left behind', async () => {
    const path = join(root, 'file.json');
    await atomicWriteJson(path, '{"x":1}');
    const entries = await fs.readdir(root);
    expect(entries).toContain('file.json');
    expect(entries).not.toContain('file.json.tmp');
  });

  it('with rollingBackup=true: rotates current into .bak when it had nodes', async () => {
    const path = join(root, 'canvas.json');
    await atomicWriteJson(path, JSON.stringify({ nodes: [{ id: 'a' }] }));
    await atomicWriteJson(path, JSON.stringify({ nodes: [{ id: 'b' }] }), {
      rollingBackup: true,
    });
    const bak = JSON.parse(await fs.readFile(`${path}.bak`, 'utf-8'));
    expect(bak.nodes[0].id).toBe('a');
  });

  it('with rollingBackup=true: skips rotation when current is unparseable', async () => {
    const path = join(root, 'canvas.json');
    await fs.writeFile(path, '{not json', 'utf-8');
    await atomicWriteJson(path, JSON.stringify({ nodes: [{ id: 'b' }] }), {
      rollingBackup: true,
    });
    expect(
      await fs
        .access(`${path}.bak`)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it('with rollingBackup=true: skips rotation when current has zero nodes', async () => {
    const path = join(root, 'canvas.json');
    await atomicWriteJson(path, JSON.stringify({ nodes: [] }));
    await atomicWriteJson(path, JSON.stringify({ nodes: [{ id: 'b' }] }), {
      rollingBackup: true,
    });
    expect(
      await fs
        .access(`${path}.bak`)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it('without rollingBackup: never creates .bak', async () => {
    const path = join(root, 'file.json');
    await atomicWriteJson(path, JSON.stringify({ nodes: [{ id: 'a' }] }));
    await atomicWriteJson(path, JSON.stringify({ nodes: [{ id: 'b' }] }));
    expect(
      await fs
        .access(`${path}.bak`)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });
});

describe('readJsonWithRecovery', () => {
  it('reads the primary file cleanly', async () => {
    const path = join(root, 'canvas.json');
    await fs.writeFile(path, JSON.stringify({ x: 1 }));
    const result = await readJsonWithRecovery<{ x: number }>(path);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.data.x).toBe(1);
    expect(result.recoveredFromBackup).toBe(false);
  });

  it('falls back to .bak when primary missing', async () => {
    const path = join(root, 'canvas.json');
    await fs.writeFile(`${path}.bak`, JSON.stringify({ x: 'bak' }));
    const result = await readJsonWithRecovery<{ x: string }>(path);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.data.x).toBe('bak');
    expect(result.recoveredFromBackup).toBe(true);
  });

  it('falls back to .bak when primary unparseable', async () => {
    const path = join(root, 'canvas.json');
    await fs.writeFile(path, '{garbage');
    await fs.writeFile(`${path}.bak`, JSON.stringify({ x: 'bak' }));
    const result = await readJsonWithRecovery<{ x: string }>(path);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.data.x).toBe('bak');
    expect(result.recoveredFromBackup).toBe(true);
  });

  it('returns missing when both files absent', async () => {
    const path = join(root, 'canvas.json');
    const result = await readJsonWithRecovery(path);
    expect(result.kind).toBe('missing');
  });

  it('returns unrecoverable when both files unparseable', async () => {
    const path = join(root, 'canvas.json');
    await fs.writeFile(path, '{garbage');
    await fs.writeFile(`${path}.bak`, '{also garbage');
    const result = await readJsonWithRecovery(path);
    expect(result.kind).toBe('unrecoverable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schema detection

describe('detectSchemaVersion', () => {
  it('treats missing schemaVersion as v1', () => {
    expect(detectSchemaVersion({ nodes: [] })).toBe(1);
  });

  it('treats schemaVersion=1 as v1', () => {
    expect(detectSchemaVersion({ schemaVersion: 1, nodes: [] })).toBe(1);
  });

  it('treats schemaVersion=2 as v2', () => {
    expect(detectSchemaVersion({ schemaVersion: 2, nodes: [] })).toBe(2);
  });

  it('treats unknown values as v1 (forward-tolerant)', () => {
    expect(detectSchemaVersion({ schemaVersion: 99 })).toBe(1);
    expect(detectSchemaVersion(null)).toBe(1);
    expect(detectSchemaVersion('not an object')).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Path safety

describe('isSafeNodeId', () => {
  it('allows realistic node ids', () => {
    expect(isSafeNodeId('node-1729123456789-42')).toBe(true);
    expect(isSafeNodeId('n_abc123')).toBe(true);
    expect(isSafeNodeId('AB.cd-EF_gh')).toBe(true);
  });

  it('rejects path separators and traversal', () => {
    expect(isSafeNodeId('../escape')).toBe(false);
    expect(isSafeNodeId('a/b')).toBe(false);
    expect(isSafeNodeId('a\\b')).toBe(false);
    expect(isSafeNodeId('.')).toBe(false);
    expect(isSafeNodeId('..')).toBe(false);
  });

  it('rejects empty and overlong ids', () => {
    expect(isSafeNodeId('')).toBe(false);
    expect(isSafeNodeId('x'.repeat(129))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-node I/O

describe('per-node I/O', () => {
  it('writes and reads back a per-node file', async () => {
    const file: PerNodeFile = {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: 'n1',
      type: 'text',
      title: 'hello',
      data: { content: '**hi**' },
      updatedAt: 1729000000000,
      createdAt: 1729000000000,
    };
    await writeNodeFile(wsId, file, root);
    const back = await readNodeFile(wsId, 'n1', root);
    expect(back).toEqual(file);
  });

  it('returns null for missing per-node file', async () => {
    const back = await readNodeFile(wsId, 'missing-id', root);
    expect(back).toBeNull();
  });

  it('returns null and does not throw on unsafe node id reads', async () => {
    expect(await readNodeFile(wsId, '../etc/passwd', root)).toBeNull();
  });

  it('refuses to write a per-node file with an unsafe id', async () => {
    await expect(
      writeNodeFile(
        wsId,
        {
          schemaVersion: PER_NODE_SCHEMA_VERSION,
          id: '../escape',
          type: 'text',
          data: {},
        },
        root,
      ),
    ).rejects.toThrow(/unsafe node id/);
  });

  it('deleteNodeFile is idempotent for missing files', async () => {
    await deleteNodeFile(wsId, 'n1', root);
    await deleteNodeFile(wsId, 'n1', root);
  });

  it('listNodeFiles enumerates parseable ids and ignores junk', async () => {
    await writeNodeFile(
      wsId,
      { schemaVersion: 1, id: 'a', type: 'text', data: {} },
      root,
    );
    await writeNodeFile(
      wsId,
      { schemaVersion: 1, id: 'b', type: 'file', data: {} },
      root,
    );
    // Drop a stray non-json file; should be ignored.
    await fs.writeFile(join(getNodesDir(wsId, root), 'README.txt'), 'noise');
    const ids = await listNodeFiles(wsId, root);
    expect(ids.sort()).toEqual(['a', 'b']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// readCanvasFull / writeCanvasFull — v1 path

describe('readCanvasFull / writeCanvasFull on v1', () => {
  it('returns null for a workspace with no canvas.json', async () => {
    const result = await readCanvasFull(wsId, root);
    expect(result.data).toBeNull();
    expect(result.schemaVersion).toBeNull();
  });

  it('reads v1 canvas.json as-is (no migration triggered)', async () => {
    const v1: CanvasSaveData = {
      nodes: [{ id: 'n1', type: 'text', data: { content: 'hi' } }],
      transform: { x: 0, y: 0, scale: 1 },
    };
    await fs.mkdir(join(root, wsId), { recursive: true });
    await fs.writeFile(getCanvasJsonPath(wsId, root), JSON.stringify(v1));
    const result = await readCanvasFull(wsId, root);
    expect(result.schemaVersion).toBe(1);
    expect(result.data?.nodes?.[0].data?.content).toBe('hi');
    // Workspace should remain v1 — PR1 does not auto-migrate.
    expect(
      await fs
        .access(getNodesDir(wsId, root))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it('writes v1 inline when workspace is v1 on disk', async () => {
    const v1: CanvasSaveData = {
      nodes: [{ id: 'n1', type: 'text', data: { content: 'a' } }],
      transform: { x: 0, y: 0, scale: 1 },
    };
    await fs.mkdir(join(root, wsId), { recursive: true });
    await fs.writeFile(getCanvasJsonPath(wsId, root), JSON.stringify(v1));

    const updated: CanvasSaveData = {
      ...v1,
      nodes: [{ id: 'n1', type: 'text', data: { content: 'b' } }],
    };
    await writeCanvasFull(wsId, updated, root);

    const raw = JSON.parse(
      await fs.readFile(getCanvasJsonPath(wsId, root), 'utf-8'),
    );
    expect(raw.nodes[0].data.content).toBe('b');
    // No nodes/ directory should be created when staying on v1.
    expect(
      await fs
        .access(getNodesDir(wsId, root))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it('writes v1 for fresh workspace (no on-disk version yet)', async () => {
    const v1: CanvasSaveData = {
      nodes: [{ id: 'fresh', type: 'text', data: {} }],
      transform: { x: 0, y: 0, scale: 1 },
    };
    await writeCanvasFull(wsId, v1, root);
    const raw = JSON.parse(
      await fs.readFile(getCanvasJsonPath(wsId, root), 'utf-8'),
    );
    expect(raw.schemaVersion).toBeUndefined();
    expect(raw.nodes[0].id).toBe('fresh');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// migrateToV2

describe('migrateToV2', () => {
  const v1Sample: CanvasSaveData = {
    nodes: [
      {
        id: 'n1',
        type: 'text',
        title: 'Hello',
        x: 0,
        y: 0,
        width: 200,
        height: 80,
        data: { content: '**hi**' },
        updatedAt: 1729000000000,
      },
      {
        id: 'n2',
        type: 'file',
        title: 'README',
        x: 300,
        y: 0,
        width: 320,
        height: 240,
        data: { filePath: '/tmp/x.md', content: '...' },
        updatedAt: 1729000000001,
      },
    ],
    edges: [{ id: 'e1', source: { kind: 'node', nodeId: 'n1' }, target: { kind: 'node', nodeId: 'n2' } }],
    transform: { x: 0, y: 0, scale: 1 },
  };

  async function seedV1(data: CanvasSaveData = v1Sample): Promise<void> {
    await fs.mkdir(join(root, wsId), { recursive: true });
    await fs.writeFile(
      getCanvasJsonPath(wsId, root),
      JSON.stringify(data, null, 2),
    );
  }

  it('migrates v1 → v2 with all nodes split out', async () => {
    await seedV1();
    await migrateToV2(wsId, { root });

    const layout = JSON.parse(
      await fs.readFile(getCanvasJsonPath(wsId, root), 'utf-8'),
    );
    expect(layout.schemaVersion).toBe(CANVAS_SCHEMA_VERSION_V2);
    expect(layout.nodes).toHaveLength(2);
    // data field should be stripped from layout entries.
    expect(layout.nodes[0].data).toBeUndefined();
    // Other layout fields preserved.
    expect(layout.nodes[0].id).toBe('n1');
    expect(layout.edges).toHaveLength(1);
    expect(layout.transform).toEqual({ x: 0, y: 0, scale: 1 });

    const n1 = await readNodeFile(wsId, 'n1', root);
    expect(n1?.data.content).toBe('**hi**');
    expect(n1?.type).toBe('text');
    expect(n1?.title).toBe('Hello');

    const n2 = await readNodeFile(wsId, 'n2', root);
    expect(n2?.data.filePath).toBe('/tmp/x.md');
  });

  it('writes a permanent .v1.bak with original v1 contents', async () => {
    await seedV1();
    await migrateToV2(wsId, { root });

    const bakRaw = await fs.readFile(getV1BackupPath(wsId, root), 'utf-8');
    const bak = JSON.parse(bakRaw);
    expect(bak.nodes).toHaveLength(2);
    expect(bak.nodes[0].data.content).toBe('**hi**'); // v1 had inline data
  });

  it('deletes the sentinel on success', async () => {
    await seedV1();
    await migrateToV2(wsId, { root });
    expect(await readSentinel(wsId, root)).toBeNull();
  });

  it('is idempotent — calling on an already-v2 workspace is a no-op', async () => {
    await seedV1();
    await migrateToV2(wsId, { root });
    const layoutBefore = await fs.readFile(
      getCanvasJsonPath(wsId, root),
      'utf-8',
    );
    await migrateToV2(wsId, { root });
    const layoutAfter = await fs.readFile(
      getCanvasJsonPath(wsId, root),
      'utf-8',
    );
    expect(layoutAfter).toBe(layoutBefore);
  });

  it('handles missing workspace gracefully', async () => {
    await migrateToV2('does-not-exist', { root });
    // No throw, no files created.
    expect(
      await fs
        .access(getCanvasJsonPath('does-not-exist', root))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it('emits progress callbacks for each phase', async () => {
    await seedV1();
    const phases: string[] = [];
    await migrateToV2(wsId, {
      root,
      onProgress: (p: MigrationProgress) => phases.push(p.phase),
    });
    expect(phases[0]).toBe('starting');
    expect(phases).toContain('backup');
    expect(phases.filter((p) => p === 'split-nodes')).toHaveLength(2);
    expect(phases).toContain('commit');
    expect(phases[phases.length - 1]).toBe('done');
  });

  it('refuses to migrate when any v1 id already has a per-node file', async () => {
    await seedV1();
    // The pollution signature: a per-node file exists for an id that's
    // about to appear in incoming v1 nodes. detectV1Pollution is strict
    // id-overlap — we don't try to inspect data-meaningfulness on either
    // side because the overlap alone shouldn't happen for any legitimate
    // v1 workspace (no v1-aware code path writes per-node files).
    await writeNodeFile(
      wsId,
      {
        schemaVersion: PER_NODE_SCHEMA_VERSION,
        id: 'n1',
        type: 'text',
        title: 'Hello',
        data: { content: 'EXISTING' },
        updatedAt: 1729999999999,
        createdAt: 1729000000000,
      },
      root,
    );

    await expect(migrateToV2(wsId, { root })).rejects.toBeInstanceOf(
      CanvasPollutionDetectedError,
    );

    // Per-node file is untouched — migration aborted before any writes.
    const n1 = await readNodeFile(wsId, 'n1', root);
    expect(n1?.data.content).toBe('EXISTING');
  });

  it('after migrate: readCanvasFull returns v1-shape with assembled data', async () => {
    await seedV1();
    await migrateToV2(wsId, { root });
    const result = await readCanvasFull(wsId, root);
    expect(result.schemaVersion).toBe(2);
    expect(result.data?.nodes).toHaveLength(2);
    expect(result.data?.nodes?.[0].data?.content).toBe('**hi**');
    // schemaVersion is hidden from callers (the helper exposes v1-shape).
    expect(result.data?.schemaVersion).toBeUndefined();
  });

  it('after migrate: writeCanvasFull splits per-node files automatically', async () => {
    await seedV1();
    await migrateToV2(wsId, { root });

    const updated: CanvasSaveData = {
      nodes: [
        {
          id: 'n1',
          type: 'text',
          title: 'Hello',
          data: { content: 'EDITED' },
          updatedAt: Date.now(),
        },
        // n2 omitted from the canvas layout; its atom file should remain.
      ],
      transform: { x: 0, y: 0, scale: 1 },
    };
    await writeCanvasFull(wsId, updated, root);

    const layout = JSON.parse(
      await fs.readFile(getCanvasJsonPath(wsId, root), 'utf-8'),
    );
    expect(layout.schemaVersion).toBe(CANVAS_SCHEMA_VERSION_V2);
    expect(layout.nodes).toHaveLength(1);

    const n1 = await readNodeFile(wsId, 'n1', root);
    expect(n1?.data.content).toBe('EDITED');
    const n2 = await readNodeFile(wsId, 'n2', root);
    expect(n2?.data.filePath).toBe('/tmp/x.md');
  });

  it('keeps workspace node properties and links out of canvas layout', async () => {
    await seedV1({
      nodes: [
        {
          id: 'n1',
          type: 'text',
          title: 'Hello',
          data: { content: '**hi**' },
          properties: {
            kind: 'note',
            tags: ['AI', 'RAG'],
          },
          links: [
            {
              relation: 'references',
              target: { nodeId: 'n2' },
            },
          ],
          updatedAt: 1729000000000,
        },
      ],
      transform: { x: 0, y: 0, scale: 1 },
    });
    await migrateToV2(wsId, { root });

    const layout = JSON.parse(await fs.readFile(getCanvasJsonPath(wsId, root), 'utf-8'));
    expect(layout.nodes[0].properties).toBeUndefined();
    expect(layout.nodes[0].links).toBeUndefined();

    const node = await readNodeFile(wsId, 'n1', root);
    expect(node?.properties?.tags).toEqual(['AI', 'RAG']);
    expect(node?.links?.[0].relation).toBe('references');

    const readBack = await readCanvasFull(wsId, root);
    expect(readBack.data?.nodes?.[0].properties?.tags).toEqual(['AI', 'RAG']);
    expect(readBack.data?.nodes?.[0].links?.[0].target.nodeId).toBe('n2');
  });

  it('preserves existing properties and links when a canvas save omits them', async () => {
    await seedV1();
    await migrateToV2(wsId, { root });
    const existing = await readNodeFile(wsId, 'n1', root);
    if (!existing) throw new Error('expected n1');
    await writeNodeFile(wsId, {
      ...existing,
      properties: { kind: 'note', tags: ['AI'] },
      links: [{ relation: 'related', target: { nodeId: 'n2' } }],
      updatedAt: 1,
    }, root);

    await writeCanvasFull(
      wsId,
      {
        nodes: [
          {
            id: 'n1',
            type: 'text',
            title: 'Hello',
            data: { content: 'EDITED' },
            updatedAt: 2,
          },
        ],
        transform: { x: 0, y: 0, scale: 1 },
      },
      root,
    );

    const node = await readNodeFile(wsId, 'n1', root);
    expect(node?.data.content).toBe('EDITED');
    expect(node?.properties?.tags).toEqual(['AI']);
    expect(node?.links?.[0].target.nodeId).toBe('n2');
  });

  it('keeps reference nodes layout-only instead of writing copied per-node data', async () => {
    await seedV1();
    await migrateToV2(wsId, { root });

    const data: CanvasSaveData = {
      nodes: [
        {
          id: 'ref-1',
          type: 'reference',
          title: 'Ref: Hello',
          x: 10,
          y: 20,
          width: 420,
          height: 300,
          ref: { kind: 'workspace-node', workspaceId: 'source-ws', nodeId: 'source-node' },
          data: {
            titleSnapshot: 'Hello',
            typeSnapshot: 'text',
            workspaceNameSnapshot: 'Source',
          },
          updatedAt: Date.now(),
        },
      ],
      transform: { x: 0, y: 0, scale: 1 },
    };
    await writeCanvasFull(wsId, data, root);

    const layout = JSON.parse(await fs.readFile(getCanvasJsonPath(wsId, root), 'utf-8'));
    expect(layout.nodes[0].ref).toEqual({ kind: 'workspace-node', workspaceId: 'source-ws', nodeId: 'source-node' });
    expect(layout.nodes[0].data.titleSnapshot).toBe('Hello');
    expect(await readNodeFile(wsId, 'ref-1', root)).toBeNull();

    const readBack = await readCanvasFull(wsId, root);
    expect(readBack.data?.nodes?.[0].data?.titleSnapshot).toBe('Hello');
    expect(readBack.data?.nodes?.[0].ref).toEqual({ kind: 'workspace-node', workspaceId: 'source-ws', nodeId: 'source-node' });
  });

  it('does not delete an existing atom file when the same id is saved as a reference node', async () => {
    await seedV1();
    await migrateToV2(wsId, { root });

    const data: CanvasSaveData = {
      nodes: [
        {
          id: 'n1',
          type: 'reference',
          title: 'Ref: Hello',
          ref: { kind: 'workspace-node', workspaceId: 'source-ws', nodeId: 'source-node' },
          data: { titleSnapshot: 'Hello' },
          updatedAt: Date.now(),
        },
      ],
      transform: { x: 0, y: 0, scale: 1 },
    };
    await writeCanvasFull(wsId, data, root);

    const n1 = await readNodeFile(wsId, 'n1', root);
    expect(n1?.data.content).toBe('**hi**');
  });

  it('writeCanvasFull respects updatedAt arbitration for per-node files', async () => {
    await seedV1();
    await migrateToV2(wsId, { root });

    // Mimic a CLI write that landed a fresh version of n1.
    await writeNodeFile(
      wsId,
      {
        schemaVersion: PER_NODE_SCHEMA_VERSION,
        id: 'n1',
        type: 'text',
        title: 'Hello',
        data: { content: 'CLI WINS' },
        updatedAt: 9999999999999,
        createdAt: 1729000000000,
      },
      root,
    );

    const stale: CanvasSaveData = {
      nodes: [
        {
          id: 'n1',
          type: 'text',
          title: 'Hello',
          data: { content: 'STALE FROM RENDERER' },
          updatedAt: 1729000000000, // older
        },
      ],
      transform: { x: 0, y: 0, scale: 1 },
    };
    await writeCanvasFull(wsId, stale, root);

    const n1 = await readNodeFile(wsId, 'n1', root);
    expect(n1?.data.content).toBe('CLI WINS');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// recoverInterruptedMigration

describe('recoverInterruptedMigration', () => {
  async function seedV1(extra: Partial<CanvasSaveData> = {}): Promise<void> {
    await fs.mkdir(join(root, wsId), { recursive: true });
    await fs.writeFile(
      getCanvasJsonPath(wsId, root),
      JSON.stringify({
        nodes: [{ id: 'survivor', type: 'text', data: { content: 'still here' } }],
        transform: { x: 0, y: 0, scale: 1 },
        ...extra,
      }),
    );
  }

  it('returns false when no sentinel is present', async () => {
    await seedV1();
    expect(await recoverInterruptedMigration(wsId, root)).toBe(false);
  });

  it('cleans partial nodes/ when canvas.json is still v1 (pre-commit crash)', async () => {
    await seedV1();
    // Leave a partial per-node file as if migration crashed mid-step-3.
    await writeNodeFile(
      wsId,
      {
        schemaVersion: PER_NODE_SCHEMA_VERSION,
        id: 'orphan',
        type: 'text',
        data: { content: 'should be cleaned' },
      },
      root,
    );
    await writeSentinel(
      wsId,
      {
        startedAt: Date.now(),
        workspaceId: wsId,
        sourceUpdatedAt: null,
        expectedNodeIds: ['orphan'],
      },
      root,
    );

    const recovered = await recoverInterruptedMigration(wsId, root);
    expect(recovered).toBe(true);
    expect(await readNodeFile(wsId, 'orphan', root)).toBeNull();
    expect(await readSentinel(wsId, root)).toBeNull();
  });

  it('preserves per-node files when canvas.json already v2 (post-commit crash)', async () => {
    // canvas.json is v2 → migration commit succeeded; only sentinel cleanup failed.
    await fs.mkdir(join(root, wsId), { recursive: true });
    await fs.writeFile(
      getCanvasJsonPath(wsId, root),
      JSON.stringify({ schemaVersion: 2, nodes: [{ id: 'n1', type: 'text' }] }),
    );
    await writeNodeFile(
      wsId,
      {
        schemaVersion: PER_NODE_SCHEMA_VERSION,
        id: 'n1',
        type: 'text',
        data: { content: 'survived' },
      },
      root,
    );
    await writeSentinel(
      wsId,
      {
        startedAt: Date.now(),
        workspaceId: wsId,
        sourceUpdatedAt: null,
        expectedNodeIds: ['n1'],
      },
      root,
    );

    const recovered = await recoverInterruptedMigration(wsId, root);
    expect(recovered).toBe(true);
    const n1 = await readNodeFile(wsId, 'n1', root);
    expect(n1?.data.content).toBe('survived');
    expect(await readSentinel(wsId, root)).toBeNull();
  });

  it('restores canvas.json from .v1.bak when primary is missing', async () => {
    // Seed: .v1.bak only; primary canvas.json vanished mid-rename.
    await fs.mkdir(join(root, wsId), { recursive: true });
    const v1Contents = JSON.stringify({
      nodes: [{ id: 'rescued', type: 'text', data: { content: 'from bak' } }],
      transform: { x: 0, y: 0, scale: 1 },
    });
    await fs.writeFile(getV1BackupPath(wsId, root), v1Contents);
    await writeSentinel(
      wsId,
      {
        startedAt: Date.now(),
        workspaceId: wsId,
        sourceUpdatedAt: null,
        expectedNodeIds: [],
      },
      root,
    );

    const recovered = await recoverInterruptedMigration(wsId, root);
    expect(recovered).toBe(true);
    expect(await readSentinel(wsId, root)).toBeNull();
    const restored = JSON.parse(
      await fs.readFile(getCanvasJsonPath(wsId, root), 'utf-8'),
    );
    expect(restored.nodes[0].id).toBe('rescued');
  });

  it('skips recovery while a migration is actively in flight in this process', async () => {
    await seedV1();
    // Simulate an in-flight migration: sentinel + partial nodes file
    // exist, AND the workspace is flagged as active. A concurrent
    // readCanvasFull must NOT touch those files.
    await writeNodeFile(
      wsId,
      {
        schemaVersion: PER_NODE_SCHEMA_VERSION,
        id: 'partial',
        type: 'text',
        data: { content: 'mid-migration write' },
      },
      root,
    );
    await writeSentinel(
      wsId,
      {
        startedAt: Date.now(),
        workspaceId: wsId,
        sourceUpdatedAt: null,
        expectedNodeIds: ['partial'],
      },
      root,
    );

    markMigrationActive(wsId);
    try {
      const recovered = await recoverInterruptedMigration(wsId, root);
      expect(recovered).toBe(false);
      // partial file and sentinel still present — recovery was correctly suppressed.
      expect(await readNodeFile(wsId, 'partial', root)).not.toBeNull();
      expect(await readSentinel(wsId, root)).not.toBeNull();
    } finally {
      clearMigrationActive(wsId);
    }
  });

  it('readCanvasFull runs recovery transparently before reading', async () => {
    await seedV1();
    await writeNodeFile(
      wsId,
      {
        schemaVersion: PER_NODE_SCHEMA_VERSION,
        id: 'orphan',
        type: 'text',
        data: { content: 'partial' },
      },
      root,
    );
    await writeSentinel(
      wsId,
      {
        startedAt: Date.now(),
        workspaceId: wsId,
        sourceUpdatedAt: null,
        expectedNodeIds: ['orphan'],
      },
      root,
    );

    const result = await readCanvasFull(wsId, root);
    expect(result.schemaVersion).toBe(1);
    expect(result.data?.nodes?.[0].id).toBe('survivor');
    // recoverInterruptedMigration should have cleaned the orphan + sentinel.
    expect(await readSentinel(wsId, root)).toBeNull();
    expect(await readNodeFile(wsId, 'orphan', root)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// v2 read with drift / missing per-node file

describe('readCanvasFull on v2 with edge cases', () => {
  it('falls back to empty data + warning when per-node file is missing', async () => {
    await fs.mkdir(join(root, wsId), { recursive: true });
    await fs.writeFile(
      getCanvasJsonPath(wsId, root),
      JSON.stringify({
        schemaVersion: 2,
        nodes: [{ id: 'lonely', type: 'text', title: 'Lonely' }],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );

    const result = await readCanvasFull(wsId, root);
    expect(result.data?.nodes?.[0].data).toEqual({});
  });

  it('does not warn or synthesize empty data for layout-only reference nodes', async () => {
    await fs.mkdir(join(root, wsId), { recursive: true });
    await fs.writeFile(
      getCanvasJsonPath(wsId, root),
      JSON.stringify({
        schemaVersion: 2,
        nodes: [
          {
            id: 'ref-1',
            type: 'reference',
            title: 'Ref: Hello',
            ref: { kind: 'workspace-node', workspaceId: 'source-ws', nodeId: 'source-node' },
            data: { titleSnapshot: 'Hello' },
          },
        ],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );

    const result = await readCanvasFull(wsId, root);
    expect(result.data?.nodes?.[0].data?.titleSnapshot).toBe('Hello');
    expect(result.data?.nodes?.[0].ref).toEqual({ kind: 'workspace-node', workspaceId: 'source-ws', nodeId: 'source-node' });
  });

  it('per-node file wins on type/title drift', async () => {
    await fs.mkdir(join(root, wsId), { recursive: true });
    await fs.writeFile(
      getCanvasJsonPath(wsId, root),
      JSON.stringify({
        schemaVersion: 2,
        nodes: [{ id: 'n1', type: 'WRONG', title: 'STALE' }],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );
    await writeNodeFile(
      wsId,
      {
        schemaVersion: PER_NODE_SCHEMA_VERSION,
        id: 'n1',
        type: 'text',
        title: 'Real title',
        data: { content: 'real' },
      },
      root,
    );

    const result = await readCanvasFull(wsId, root);
    expect(result.data?.nodes?.[0].type).toBe('text');
    expect(result.data?.nodes?.[0].title).toBe('Real title');
    expect(result.data?.nodes?.[0].data?.content).toBe('real');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pollution detection — catches the scenario where a v1-unaware writer
// (old binary, external script) clobbered a v2 workspace's canvas.json
// and a follow-up v2 read would otherwise destructively re-migrate.

async function seedV2Workspace(): Promise<void> {
  await fs.mkdir(getNodesDir(wsId, root), { recursive: true });
  await fs.writeFile(
    getCanvasJsonPath(wsId, root),
    JSON.stringify({
      schemaVersion: 2,
      nodes: [
        { id: 'n1', type: 'text', title: 'A', x: 0, y: 0, width: 100, height: 80, updatedAt: 100 },
        { id: 'n2', type: 'text', title: 'B', x: 0, y: 0, width: 100, height: 80, updatedAt: 100 },
      ],
      transform: { x: 0, y: 0, scale: 1 },
    }),
  );
  await writeNodeFile(wsId, {
    schemaVersion: PER_NODE_SCHEMA_VERSION,
    id: 'n1',
    type: 'text',
    title: 'A',
    data: { content: 'real-A' },
    updatedAt: 100,
    createdAt: 100,
  }, root);
  await writeNodeFile(wsId, {
    schemaVersion: PER_NODE_SCHEMA_VERSION,
    id: 'n2',
    type: 'text',
    title: 'B',
    data: { content: 'real-B' },
    updatedAt: 100,
    createdAt: 100,
  }, root);
}

describe('detectV1Pollution', () => {
  it('returns empty for fresh workspace with no nodes/ files', async () => {
    const result = await detectV1Pollution(
      wsId,
      [{ id: 'n1', type: 'text', title: 'A' }],
      root,
    );
    expect(result).toEqual([]);
  });

  it('returns the ids that overlap with on-disk nodes/ files', async () => {
    await seedV2Workspace();
    const result = await detectV1Pollution(
      wsId,
      [
        { id: 'n1', type: 'text', title: 'A' },
        { id: 'never-existed', type: 'text', title: 'X' },
        { id: 'n2', type: 'text', title: 'B' },
      ],
      root,
    );
    expect(result.sort()).toEqual(['n1', 'n2']);
  });

  it('ignores unsafe ids (defensive)', async () => {
    await seedV2Workspace();
    const result = await detectV1Pollution(
      wsId,
      [{ id: '../escape', type: 'text', title: 'X' }],
      root,
    );
    expect(result).toEqual([]);
  });

  it('returns empty when incoming has no nodes', async () => {
    await seedV2Workspace();
    expect(await detectV1Pollution(wsId, [], root)).toEqual([]);
    expect(await detectV1Pollution(wsId, undefined, root)).toEqual([]);
  });
});

describe('writeCanvasFull pollution guard', () => {
  it('refuses to write v1-shape when overlapping nodes/<id>.json exists', async () => {
    await seedV2Workspace();
    // Simulate the v1-unaware-writer scenario: someone read v2 canvas.json
    // (got empty-data layout) and is about to write it back as a v1
    // canvas. To get writeCanvasFull onto the v1 branch we degrade the
    // on-disk canvas.json to v1 shape first (this is the state any
    // v1-unaware code path would have left behind).
    await fs.writeFile(
      getCanvasJsonPath(wsId, root),
      JSON.stringify({
        nodes: [
          { id: 'n1', type: 'text', title: 'A', x: 0, y: 0, width: 100, height: 80, data: {} },
        ],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );

    const incoming: CanvasSaveData = {
      nodes: [
        { id: 'n1', type: 'text', title: 'A', x: 0, y: 0, width: 100, height: 80, data: {} },
      ],
      transform: { x: 0, y: 0, scale: 1 },
    };

    await expect(writeCanvasFull(wsId, incoming, root)).rejects.toBeInstanceOf(
      CanvasPollutionDetectedError,
    );
    // And the real per-node file is still intact — the throw was BEFORE any
    // destructive disk operation.
    const n1 = await readNodeFile(wsId, 'n1', root);
    expect(n1?.data?.content).toBe('real-A');
  });

  it('permits v1 write when no per-node files exist (legit fresh v1 workspace)', async () => {
    await fs.mkdir(join(root, wsId), { recursive: true });
    const incoming: CanvasSaveData = {
      nodes: [
        { id: 'fresh', type: 'text', title: '', x: 0, y: 0, width: 10, height: 10, data: { content: 'hi' } },
      ],
      transform: { x: 0, y: 0, scale: 1 },
    };
    await writeCanvasFull(wsId, incoming, root);
    const raw = JSON.parse(await fs.readFile(getCanvasJsonPath(wsId, root), 'utf-8'));
    expect(raw.nodes[0].data.content).toBe('hi');
  });
});

describe('migrateToV2 pollution guard', () => {
  it('refuses migration when v1 ids overlap existing per-node files', async () => {
    await seedV2Workspace();
    // Same shape as the v1-unaware-writer aftermath: canvas.json now
    // looks v1 (no schemaVersion, no data fields) but nodes/ still has
    // the real per-node files.
    await fs.writeFile(
      getCanvasJsonPath(wsId, root),
      JSON.stringify({
        nodes: [
          { id: 'n1', type: 'text', title: 'A', x: 0, y: 0, width: 100, height: 80 },
          { id: 'n2', type: 'text', title: 'B', x: 0, y: 0, width: 100, height: 80 },
        ],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );

    await expect(migrateToV2(wsId, { root })).rejects.toBeInstanceOf(
      CanvasPollutionDetectedError,
    );
    // Per-node files still hold real data — migration aborted before
    // overwriting them. This is the property the user lost in the
    // original incident.
    expect((await readNodeFile(wsId, 'n1', root))?.data?.content).toBe('real-A');
    expect((await readNodeFile(wsId, 'n2', root))?.data?.content).toBe('real-B');
    // No sentinel was written either — abort happened pre-side-effects.
    expect(await readSentinel(wsId, root)).toBeNull();
  });

  it('still migrates legitimate v1 workspaces with no per-node files', async () => {
    await fs.mkdir(join(root, wsId), { recursive: true });
    await fs.writeFile(
      getCanvasJsonPath(wsId, root),
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', title: 'A', x: 0, y: 0, width: 10, height: 10, data: { content: 'va' }, updatedAt: 1 },
        ],
        transform: { x: 0, y: 0, scale: 1 },
        savedAt: 'x',
      }),
    );
    await migrateToV2(wsId, { root });
    const layout = JSON.parse(await fs.readFile(getCanvasJsonPath(wsId, root), 'utf-8'));
    expect(layout.schemaVersion).toBe(CANVAS_SCHEMA_VERSION_V2);
    const n = await readNodeFile(wsId, 'a', root);
    expect(n?.data?.content).toBe('va');
  });
});

describe('migrateToV2 timestamped backups', () => {
  it('writes both the timestamped archive and the stable .v1.bak alias', async () => {
    await fs.mkdir(join(root, wsId), { recursive: true });
    await fs.writeFile(
      getCanvasJsonPath(wsId, root),
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', title: '', x: 0, y: 0, width: 10, height: 10, data: { content: 'X' }, updatedAt: 1 },
        ],
        transform: { x: 0, y: 0, scale: 1 },
        savedAt: 'x',
      }),
    );
    await migrateToV2(wsId, { root });

    // Stable alias exists with the original v1 content.
    const stable = JSON.parse(await fs.readFile(getV1BackupPath(wsId, root), 'utf-8'));
    expect(stable.nodes[0].data.content).toBe('X');

    // And exactly one timestamped archive exists with the same content.
    const wsDir = getWorkspaceDir(wsId, root);
    const archives = (await fs.readdir(wsDir)).filter(
      (f) => f.startsWith('canvas.json.v1.') && f.endsWith('.bak') && f !== 'canvas.json.v1.bak',
    );
    expect(archives).toHaveLength(1);
    const tsArchive = JSON.parse(
      await fs.readFile(join(wsDir, archives[0]), 'utf-8'),
    );
    expect(tsArchive.nodes[0].data.content).toBe('X');
  });

  it('getV1TimestampedBackupPath produces a filesystem-friendly filename', () => {
    const p = getV1TimestampedBackupPath(
      wsId,
      new Date('2026-05-25T09:30:42.123Z'),
      root,
    );
    // No raw colons or dots-as-time-separator in the timestamp segment.
    const filename = p.split('/').pop()!;
    expect(filename).toMatch(/^canvas\.json\.v1\.2026-05-25T09-30-42-123Z\.bak$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Startup-time pollution scanner

describe('scanForPollutedWorkspaces', () => {
  it('returns empty for a fresh store', async () => {
    expect(await scanForPollutedWorkspaces(root)).toEqual([]);
  });

  it('skips workspaces whose canvas.json is already v2', async () => {
    const wsDir = getWorkspaceDir(wsId, root);
    await fs.mkdir(wsDir, { recursive: true });
    await fs.writeFile(
      getCanvasJsonPath(wsId, root),
      JSON.stringify({
        schemaVersion: 2,
        nodes: [{ id: 'a', type: 'text', title: 'A', x: 0, y: 0, width: 10, height: 10 }],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );
    await writeNodeFile(wsId, {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: 'a',
      type: 'text',
      title: 'A',
      data: { content: 'real' },
    }, root);
    expect(await scanForPollutedWorkspaces(root)).toEqual([]);
  });

  it('skips workspaces with an unreadable canvas.json (not the pollution signature)', async () => {
    await fs.mkdir(getWorkspaceDir(wsId, root), { recursive: true });
    // No canvas.json — should be silently skipped.
    expect(await scanForPollutedWorkspaces(root)).toEqual([]);
  });

  it('reports workspaces where v1 canvas.json overlaps existing nodes/ files', async () => {
    const wsDir = getWorkspaceDir(wsId, root);
    await fs.mkdir(wsDir, { recursive: true });
    await fs.writeFile(
      getCanvasJsonPath(wsId, root),
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', title: 'A', x: 0, y: 0, width: 10, height: 10 },
          { id: 'b', type: 'text', title: 'B', x: 0, y: 0, width: 10, height: 10 },
        ],
        transform: { x: 0, y: 0, scale: 1 },
      }),
    );
    await writeNodeFile(wsId, {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: 'a',
      type: 'text',
      title: 'A',
      data: { content: 'real-a' },
    }, root);

    const findings = await scanForPollutedWorkspaces(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].workspaceId).toBe(wsId);
    expect(findings[0].conflictingNodeIds).toEqual(['a']);
  });

  it('ignores the __workspaces__ manifest directory entry', async () => {
    await fs.mkdir(join(root, '__workspaces__'), { recursive: true });
    expect(await scanForPollutedWorkspaces(root)).toEqual([]);
  });
});
