import { randomUUID } from 'node:crypto';
import type { PulseStorage } from '@pulse-coder/storage';
import { createCanvasCompatibilityStore, type LegacyCanvas } from '@pulse-coder/storage/canvas';

interface CanvasNodeRecord {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  content?: string;
  url?: string;
  filePath?: string;
  color?: string;
  [key: string]: unknown;
}

interface CanvasEdgeRecord {
  id: string;
  fromNode: string;
  toNode: string;
  label?: string;
  [key: string]: unknown;
}

export type CanvasAgentToolName =
  | 'canvas_get_overview'
  | 'canvas_read_node'
  | 'canvas_create_node'
  | 'canvas_update_node'
  | 'canvas_delete_node'
  | 'canvas_create_edge';

export const CANVAS_AGENT_TOOL_NAMES = new Set<string>([
  'canvas_get_overview',
  'canvas_read_node',
  'canvas_create_node',
  'canvas_update_node',
  'canvas_delete_node',
  'canvas_create_edge',
]);

function pickNextPosition(nodes: CanvasNodeRecord[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 120, y: 120 };
  let maxRight = -Infinity;
  let sumY = 0;
  for (const n of nodes) {
    const right = (typeof n.x === 'number' ? n.x : 0) + (typeof n.width === 'number' ? n.width : 320);
    if (right > maxRight) maxRight = right;
    sumY += typeof n.y === 'number' ? n.y : 0;
  }
  return {
    x: Math.round(maxRight + 60),
    y: Math.round(sumY / nodes.length),
  };
}

export async function summarizeCanvasForPrompt(
  storage: PulseStorage,
  workspaceId: string,
): Promise<string> {
  try {
    const store = createCanvasCompatibilityStore(storage.canvas);
    const canvas = await store.readCanvas(workspaceId);
    if (!canvas) return 'Canvas workspace is currently empty.';
    const nodes = (Array.isArray(canvas.nodes) ? canvas.nodes : []) as CanvasNodeRecord[];
    const edges = (Array.isArray(canvas.edges) ? canvas.edges : []) as CanvasEdgeRecord[];
    if (nodes.length === 0) return 'Canvas workspace is currently empty.';
    const preview = nodes.slice(0, 24).map((n) => {
      const title = typeof n.title === 'string' && n.title.trim() ? n.title.trim() : '(untitled)';
      return `- [${n.id}] (${n.type}) ${title}`;
    });
    const more = nodes.length > 24 ? `\n... and ${nodes.length - 24} more nodes (use canvas_get_overview for full list).` : '';
    return `Canvas has ${nodes.length} nodes and ${edges.length} edges:\n${preview.join('\n')}${more}`;
  } catch {
    return 'Canvas overview unavailable.';
  }
}

export async function executeCanvasAgentTool(
  tool: CanvasAgentToolName,
  input: Record<string, unknown>,
  storage: PulseStorage,
  workspaceId: string,
  onMutation?: () => void,
): Promise<unknown> {
  const store = createCanvasCompatibilityStore(storage.canvas);
  const existing = (await store.readCanvas(workspaceId)) ?? {
    version: 1,
    nodes: [],
    edges: [],
  };
  const nodes = (Array.isArray(existing.nodes) ? [...existing.nodes] : []) as CanvasNodeRecord[];
  const edges = (Array.isArray(existing.edges) ? [...existing.edges] : []) as CanvasEdgeRecord[];

  switch (tool) {
    case 'canvas_get_overview': {
      return {
        workspaceId,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        nodes: nodes.slice(0, 120).map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title ?? '',
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          preview: typeof n.content === 'string' ? n.content.slice(0, 200) : undefined,
          url: typeof n.url === 'string' ? n.url : undefined,
        })),
        edges: edges.slice(0, 150).map((e) => ({
          id: e.id,
          fromNode: e.fromNode,
          toNode: e.toNode,
          ...(e.label ? { label: e.label } : {}),
        })),
      };
    }

    case 'canvas_read_node': {
      const nodeId = typeof input.nodeId === 'string' ? input.nodeId.trim() : '';
      if (!nodeId) throw new Error('nodeId is required');
      const found = nodes.find((n) => n.id === nodeId);
      if (!found) return { ok: false, error: `Node not found: ${nodeId}` };
      return { ok: true, node: found };
    }

    case 'canvas_create_node': {
      const rawType = typeof input.type === 'string' ? input.type.trim() : 'text';
      const type = ['text', 'frame', 'url', 'file'].includes(rawType) ? rawType : 'text';
      const pos = pickNextPosition(nodes);
      const id = `node-${randomUUID().slice(0, 8)}`;
      const node: CanvasNodeRecord = {
        id,
        type,
        x: typeof input.x === 'number' ? input.x : pos.x,
        y: typeof input.y === 'number' ? input.y : pos.y,
        width: typeof input.width === 'number' ? input.width : type === 'frame' ? 640 : 360,
        height: typeof input.height === 'number' ? input.height : type === 'frame' ? 420 : 240,
        ...(typeof input.title === 'string' ? { title: input.title } : {}),
        ...(typeof input.content === 'string' ? { content: input.content } : {}),
        ...(typeof input.url === 'string' ? { url: input.url } : {}),
        ...(typeof input.color === 'string' ? { color: input.color } : {}),
      };
      nodes.push(node);

      let createdEdge: CanvasEdgeRecord | undefined;
      if (typeof input.connectFromNodeId === 'string' && input.connectFromNodeId.trim()) {
        const fromId = input.connectFromNodeId.trim();
        if (nodes.some((n) => n.id === fromId)) {
          createdEdge = {
            id: `edge-${randomUUID().slice(0, 8)}`,
            fromNode: fromId,
            toNode: id,
            ...(typeof input.edgeLabel === 'string' && input.edgeLabel.trim()
              ? { label: input.edgeLabel.trim() }
              : {}),
          };
          edges.push(createdEdge);
        }
      }

      await store.writeCanvas(workspaceId, { ...existing, nodes, edges } as LegacyCanvas, { allowEmpty: true });
      onMutation?.();
      return { ok: true, node, ...(createdEdge ? { edge: createdEdge } : {}) };
    }

    case 'canvas_update_node': {
      const nodeId = typeof input.nodeId === 'string' ? input.nodeId.trim() : '';
      if (!nodeId) throw new Error('nodeId is required');
      const idx = nodes.findIndex((n) => n.id === nodeId);
      if (idx < 0) return { ok: false, error: `Node not found: ${nodeId}` };
      const next = { ...nodes[idx] };
      if (typeof input.title === 'string') next.title = input.title;
      if (typeof input.content === 'string') next.content = input.content;
      if (typeof input.color === 'string') next.color = input.color;
      if (typeof input.x === 'number') next.x = input.x;
      if (typeof input.y === 'number') next.y = input.y;
      if (typeof input.width === 'number') next.width = input.width;
      if (typeof input.height === 'number') next.height = input.height;
      nodes[idx] = next;
      await store.writeCanvas(workspaceId, { ...existing, nodes, edges } as LegacyCanvas, { allowEmpty: true });
      onMutation?.();
      return { ok: true, node: next };
    }

    case 'canvas_delete_node': {
      const nodeId = typeof input.nodeId === 'string' ? input.nodeId.trim() : '';
      if (!nodeId) throw new Error('nodeId is required');
      const nextNodes = nodes.filter((n) => n.id !== nodeId);
      if (nextNodes.length === nodes.length) {
        return { ok: false, error: `Node not found: ${nodeId}` };
      }
      const nextEdges = edges.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId);
      await store.writeCanvas(workspaceId, { ...existing, nodes: nextNodes, edges: nextEdges } as LegacyCanvas, {
        allowEmpty: true,
      });
      onMutation?.();
      return { ok: true, deletedNodeId: nodeId };
    }

    case 'canvas_create_edge': {
      const fromNode = typeof input.fromNode === 'string' ? input.fromNode.trim() : '';
      const toNode = typeof input.toNode === 'string' ? input.toNode.trim() : '';
      if (!fromNode || !toNode) throw new Error('fromNode and toNode are required');
      if (!nodes.some((n) => n.id === fromNode) || !nodes.some((n) => n.id === toNode)) {
        return { ok: false, error: 'Both fromNode and toNode must exist on the canvas' };
      }
      const edge: CanvasEdgeRecord = {
        id: `edge-${randomUUID().slice(0, 8)}`,
        fromNode,
        toNode,
        ...(typeof input.label === 'string' && input.label.trim() ? { label: input.label.trim() } : {}),
      };
      edges.push(edge);
      await store.writeCanvas(workspaceId, { ...existing, nodes, edges } as LegacyCanvas, { allowEmpty: true });
      onMutation?.();
      return { ok: true, edge };
    }
  }
}
