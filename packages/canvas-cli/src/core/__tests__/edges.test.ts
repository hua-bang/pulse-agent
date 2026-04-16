import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createWorkspace, loadCanvas, commitEdgeMutation } from '../store';
import { createNode } from '../nodes';
import { createEdge, deleteEdge, listEdges } from '../edges';
import type { CanvasEdge } from '../types';

let testDir: string;
let workspaceId: string;
let nodeAId: string;
let nodeBId: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `canvas-edge-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(testDir, { recursive: true });

  const ws = await createWorkspace('Edge Test', testDir);
  if (!ws.ok) throw new Error('Failed to create workspace');
  workspaceId = ws.data.id;

  const nodeA = await createNode(workspaceId, { type: 'frame', title: 'Frame A' }, testDir);
  if (!nodeA.ok) throw new Error('Failed to create node A');
  nodeAId = nodeA.data.nodeId;

  const nodeB = await createNode(workspaceId, { type: 'frame', title: 'Frame B' }, testDir);
  if (!nodeB.ok) throw new Error('Failed to create node B');
  nodeBId = nodeB.data.nodeId;
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('edges', () => {
  describe('createEdge', () => {
    it('creates an edge between two nodes', async () => {
      const result = await createEdge(workspaceId, {
        sourceNodeId: nodeAId,
        targetNodeId: nodeBId,
        label: 'depends on',
        kind: 'dependency',
      }, testDir);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.edgeId).toMatch(/^edge-/);

      const canvas = await loadCanvas(workspaceId, testDir);
      expect(canvas?.edges).toHaveLength(1);
      expect(canvas?.edges?.[0].source).toEqual({ kind: 'node', nodeId: nodeAId, anchor: 'auto' });
      expect(canvas?.edges?.[0].target).toEqual({ kind: 'node', nodeId: nodeBId, anchor: 'auto' });
      expect(canvas?.edges?.[0].label).toBe('depends on');
      expect(canvas?.edges?.[0].kind).toBe('dependency');
    });

    it('fails when source node does not exist', async () => {
      const result = await createEdge(workspaceId, {
        sourceNodeId: 'nonexistent',
        targetNodeId: nodeBId,
      }, testDir);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Source node not found');
    });

    it('fails when target node does not exist', async () => {
      const result = await createEdge(workspaceId, {
        sourceNodeId: nodeAId,
        targetNodeId: 'nonexistent',
      }, testDir);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Target node not found');
    });

    it('fails when workspace does not exist', async () => {
      const result = await createEdge('nonexistent', {
        sourceNodeId: nodeAId,
        targetNodeId: nodeBId,
      }, testDir);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Workspace not found');
    });

    it('applies custom stroke and arrow options', async () => {
      const result = await createEdge(workspaceId, {
        sourceNodeId: nodeAId,
        targetNodeId: nodeBId,
        arrowHead: 'arrow',
        arrowTail: 'dot',
        stroke: { color: '#ff0000', width: 3, style: 'dashed' },
        bend: 50,
      }, testDir);

      expect(result.ok).toBe(true);

      const canvas = await loadCanvas(workspaceId, testDir);
      const edge = canvas?.edges?.[0];
      expect(edge?.arrowHead).toBe('arrow');
      expect(edge?.arrowTail).toBe('dot');
      expect(edge?.stroke).toEqual({ color: '#ff0000', width: 3, style: 'dashed' });
      expect(edge?.bend).toBe(50);
    });

    it('applies custom anchors', async () => {
      const result = await createEdge(workspaceId, {
        sourceNodeId: nodeAId,
        targetNodeId: nodeBId,
        sourceAnchor: 'right',
        targetAnchor: 'left',
      }, testDir);

      expect(result.ok).toBe(true);

      const canvas = await loadCanvas(workspaceId, testDir);
      const edge = canvas?.edges?.[0];
      expect(edge?.source).toEqual({ kind: 'node', nodeId: nodeAId, anchor: 'right' });
      expect(edge?.target).toEqual({ kind: 'node', nodeId: nodeBId, anchor: 'left' });
    });
  });

  describe('deleteEdge', () => {
    it('deletes an existing edge', async () => {
      const createResult = await createEdge(workspaceId, {
        sourceNodeId: nodeAId,
        targetNodeId: nodeBId,
      }, testDir);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const deleteResult = await deleteEdge(workspaceId, createResult.data.edgeId, testDir);
      expect(deleteResult.ok).toBe(true);

      const canvas = await loadCanvas(workspaceId, testDir);
      expect(canvas?.edges ?? []).toHaveLength(0);
    });

    it('fails when edge does not exist', async () => {
      const result = await deleteEdge(workspaceId, 'nonexistent', testDir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Edge not found');
    });

    it('fails when workspace does not exist', async () => {
      const result = await deleteEdge('nonexistent', 'some-edge', testDir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Workspace not found');
    });
  });

  describe('listEdges', () => {
    it('returns empty array when no edges', async () => {
      const edges = await listEdges(workspaceId, testDir);
      expect(edges).toEqual([]);
    });

    it('returns all edges', async () => {
      await createEdge(workspaceId, {
        sourceNodeId: nodeAId,
        targetNodeId: nodeBId,
        label: 'first',
      }, testDir);
      await createEdge(workspaceId, {
        sourceNodeId: nodeBId,
        targetNodeId: nodeAId,
        label: 'second',
      }, testDir);

      const edges = await listEdges(workspaceId, testDir);
      expect(edges).toHaveLength(2);
      expect(edges.map(e => e.label).sort()).toEqual(['first', 'second']);
    });

    it('returns empty for nonexistent workspace', async () => {
      const edges = await listEdges('nonexistent', testDir);
      expect(edges).toEqual([]);
    });
  });

  describe('commitEdgeMutation', () => {
    it('upserts an edge', async () => {
      const edge: CanvasEdge = {
        id: 'edge-test-1',
        source: { kind: 'node', nodeId: nodeAId },
        target: { kind: 'node', nodeId: nodeBId },
        updatedAt: Date.now(),
      };

      const result = await commitEdgeMutation(workspaceId, { upsert: edge }, testDir);
      expect(result).not.toBeNull();
      expect(result?.edges).toHaveLength(1);
      expect(result?.edges?.[0].id).toBe('edge-test-1');
    });

    it('replaces an existing edge by id', async () => {
      const edge1: CanvasEdge = {
        id: 'edge-test-1',
        source: { kind: 'node', nodeId: nodeAId },
        target: { kind: 'node', nodeId: nodeBId },
        label: 'original',
        updatedAt: Date.now(),
      };
      await commitEdgeMutation(workspaceId, { upsert: edge1 }, testDir);

      const edge2: CanvasEdge = {
        ...edge1,
        label: 'updated',
        updatedAt: Date.now(),
      };
      await commitEdgeMutation(workspaceId, { upsert: edge2 }, testDir);

      const canvas = await loadCanvas(workspaceId, testDir);
      expect(canvas?.edges).toHaveLength(1);
      expect(canvas?.edges?.[0].label).toBe('updated');
    });

    it('removes an edge by id', async () => {
      const edge: CanvasEdge = {
        id: 'edge-to-remove',
        source: { kind: 'node', nodeId: nodeAId },
        target: { kind: 'node', nodeId: nodeBId },
        updatedAt: Date.now(),
      };
      await commitEdgeMutation(workspaceId, { upsert: edge }, testDir);

      const result = await commitEdgeMutation(workspaceId, { removeId: 'edge-to-remove' }, testDir);
      expect(result).not.toBeNull();
      expect(result?.edges).toHaveLength(0);
    });

    it('returns null when removing nonexistent edge', async () => {
      const result = await commitEdgeMutation(workspaceId, { removeId: 'nope' }, testDir);
      expect(result).toBeNull();
    });
  });
});
