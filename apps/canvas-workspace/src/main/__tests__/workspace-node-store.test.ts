import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  WORKSPACE_NODE_SCHEMA_VERSION,
  deleteWorkspaceNode,
  getNodeFilePath,
  getNodesDir,
  isSafeNodeId,
  listWorkspaceNodeIds,
  listWorkspaceNodes,
  readWorkspaceNode,
  writeWorkspaceNode,
  type WorkspaceNodeRecord,
} from '../canvas/nodes/store';

let root: string;
const wsId = 'ws-test';

beforeEach(async () => {
  root = join(
    tmpdir(),
    `workspace-node-store-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await fs.mkdir(root, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('workspace-node-store', () => {
  it('writes and reads a workspace node with properties and links', async () => {
    const record: WorkspaceNodeRecord = {
      schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
      id: 'n1',
      type: 'text',
      title: 'RAG Notes',
      data: { content: 'hello' },
      properties: {
        kind: 'note',
        tags: ['AI', 'RAG'],
        sourceUrl: { type: 'url', value: 'https://example.com' },
      },
      links: [
        {
          relation: 'references',
          target: { nodeId: 'n2' },
          properties: { confidence: 0.8 },
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    };

    await writeWorkspaceNode(wsId, record, root);

    const back = await readWorkspaceNode(wsId, 'n1', root);
    expect(back).toEqual(record);
  });

  it('lists workspace node ids and records', async () => {
    await writeWorkspaceNode(
      wsId,
      {
        schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
        id: 'a',
        type: 'text',
        data: { content: 'a' },
      },
      root,
    );
    await writeWorkspaceNode(
      wsId,
      {
        schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
        id: 'b',
        type: 'file',
        data: { filePath: '/tmp/b.md' },
      },
      root,
    );
    await fs.writeFile(join(getNodesDir(wsId, root), 'README.txt'), 'noise');

    expect(await listWorkspaceNodeIds(wsId, root)).toEqual(['a', 'b']);
    const records = await listWorkspaceNodes(wsId, root);
    expect(records.map((record) => record.id)).toEqual(['a', 'b']);
  });

  it('rejects unsafe node ids for writes and returns null for reads', async () => {
    expect(isSafeNodeId('../escape')).toBe(false);
    expect(await readWorkspaceNode(wsId, '../escape', root)).toBeNull();
    await expect(
      writeWorkspaceNode(
        wsId,
        {
          schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
          id: '../escape',
          type: 'text',
          data: {},
        },
        root,
      ),
    ).rejects.toThrow(/unsafe node id/);
  });

  it('deletes a workspace node explicitly', async () => {
    await writeWorkspaceNode(
      wsId,
      {
        schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
        id: 'n1',
        type: 'text',
        data: {},
      },
      root,
    );
    expect(await fs.access(getNodeFilePath(wsId, 'n1', root)).then(() => true)).toBe(true);

    await deleteWorkspaceNode(wsId, 'n1', root);
    expect(await readWorkspaceNode(wsId, 'n1', root)).toBeNull();
  });
});
