import { loadCanvas, commitEdgeMutation } from './store';
import { notifyCanvasUpdated } from './notifier';
import type {
  CanvasEdge,
  EdgeAnchor,
  EdgeArrowCap,
  EdgeStroke,
  Result,
} from './types';

export interface CreateEdgeOptions {
  sourceNodeId: string;
  targetNodeId: string;
  sourceAnchor?: EdgeAnchor;
  targetAnchor?: EdgeAnchor;
  label?: string;
  kind?: string;
  arrowHead?: EdgeArrowCap;
  arrowTail?: EdgeArrowCap;
  stroke?: EdgeStroke;
  bend?: number;
  payload?: Record<string, unknown>;
}

export async function createEdge(
  workspaceId: string,
  opts: CreateEdgeOptions,
  storeDir?: string,
): Promise<Result<{ edgeId: string }>> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return { ok: false, error: `Workspace not found: ${workspaceId}` };

  // Validate that both source and target nodes exist
  const sourceExists = canvas.nodes.some(n => n.id === opts.sourceNodeId);
  if (!sourceExists) return { ok: false, error: `Source node not found: ${opts.sourceNodeId}` };

  const targetExists = canvas.nodes.some(n => n.id === opts.targetNodeId);
  if (!targetExists) return { ok: false, error: `Target node not found: ${opts.targetNodeId}` };

  const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const newEdge: CanvasEdge = {
    id: edgeId,
    source: { kind: 'node', nodeId: opts.sourceNodeId, anchor: opts.sourceAnchor ?? 'auto' },
    target: { kind: 'node', nodeId: opts.targetNodeId, anchor: opts.targetAnchor ?? 'auto' },
    bend: opts.bend ?? 0,
    arrowHead: opts.arrowHead ?? 'triangle',
    arrowTail: opts.arrowTail ?? 'none',
    stroke: opts.stroke ?? { color: '#1f2328', width: 2.4, style: 'solid' },
    label: opts.label,
    kind: opts.kind,
    payload: opts.payload,
    updatedAt: Date.now(),
  };

  await commitEdgeMutation(workspaceId, { upsert: newEdge }, storeDir);
  await notifyCanvasUpdated({ workspaceId, nodeIds: [], kind: 'update' });

  return { ok: true, data: { edgeId } };
}

export async function deleteEdge(
  workspaceId: string,
  edgeId: string,
  storeDir?: string,
): Promise<Result> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return { ok: false, error: `Workspace not found: ${workspaceId}` };

  const edges = canvas.edges ?? [];
  const exists = edges.some(e => e.id === edgeId);
  if (!exists) return { ok: false, error: `Edge not found: ${edgeId}` };

  const result = await commitEdgeMutation(workspaceId, { removeId: edgeId }, storeDir);
  if (!result) return { ok: false, error: `Edge not found: ${edgeId}` };
  await notifyCanvasUpdated({ workspaceId, nodeIds: [], kind: 'delete' });

  return { ok: true, data: undefined };
}

export async function listEdges(
  workspaceId: string,
  storeDir?: string,
): Promise<CanvasEdge[]> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return [];
  return canvas.edges ?? [];
}
