import { z } from 'zod';
import type { CanvasEdge, CanvasTool, EdgeArrowCap, EdgeEndpoint, EdgeStroke } from './types';
import { loadCanvas, saveCanvas } from './_shared/canvas-io';
import { broadcastUpdate } from './_shared/broadcast';
import { buildEndpoint, describeEndpoint, genEdgeId } from './_shared/edges';

export function createEdgeTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_list_edges: {
      name: 'canvas_list_edges',
      defer_loading: true,
      description:
        'List every edge (connection / arrow) on the canvas with resolved endpoint titles. ' +
        'Useful when you need to understand what the user has linked together — e.g. to figure out ' +
        'which file node backs an agent node, or to find nodes that reference each other. ' +
        'Defaults to the current workspace; pass `workspaceId` to inspect another canvas the user @-mentioned.',
      inputSchema: z.object({
        workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace.'),
      }),
      execute: async (input) => {
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        const canvas = await loadCanvas(targetWorkspaceId);
        if (!canvas) return `Error: workspace not found: ${targetWorkspaceId}`;
        const edges = canvas.edges ?? [];
        if (edges.length === 0) return 'No edges on this canvas.';
        const nodesById = new Map(canvas.nodes.map((n) => [n.id, n]));
        return JSON.stringify(
          edges.map((e) => ({
            id: e.id,
            source: describeEndpoint(e.source, nodesById),
            target: describeEndpoint(e.target, nodesById),
            label: e.label,
            kind: e.kind,
            arrowHead: e.arrowHead ?? 'triangle',
            arrowTail: e.arrowTail ?? 'none',
            stroke: e.stroke,
            bend: e.bend ?? 0,
          })),
          null,
          2,
        );
      },
    },

    canvas_create_edge: {
      name: 'canvas_create_edge',
      defer_loading: true,
      description:
        'Connect two nodes (or free points) on the canvas with an arrow. ' +
        'Endpoints are node-bound by default: pass `sourceNodeId` / `targetNodeId`. For a free-floating ' +
        'endpoint (not attached to any node) pass `sourceX`/`sourceY` or `targetX`/`targetY` in canvas coords instead. ' +
        'Use `label` to annotate the connection with text the user will see. ' +
        'Use `kind` and `payload` to tag the edge with semantic info other tools can read later ' +
        '(e.g. `kind: "depends-on"`, `payload: { reason: "uses the PRD" }`).',
      inputSchema: z.object({
        sourceNodeId: z.string().optional().describe('Source node ID (node-bound endpoint).'),
        sourceAnchor: z.enum(['top', 'right', 'bottom', 'left', 'auto']).optional()
          .describe('Which side of the source node to anchor to. Default: "auto" (edge-hugging).'),
        sourceX: z.number().optional().describe('Free-point source X (canvas coords). Used if sourceNodeId is omitted.'),
        sourceY: z.number().optional().describe('Free-point source Y (canvas coords). Used if sourceNodeId is omitted.'),
        targetNodeId: z.string().optional().describe('Target node ID (node-bound endpoint).'),
        targetAnchor: z.enum(['top', 'right', 'bottom', 'left', 'auto']).optional()
          .describe('Which side of the target node to anchor to. Default: "auto".'),
        targetX: z.number().optional().describe('Free-point target X (canvas coords).'),
        targetY: z.number().optional().describe('Free-point target Y (canvas coords).'),
        label: z.string().optional().describe('Optional short label displayed on the edge.'),
        arrowHead: z.enum(['none', 'triangle', 'arrow', 'dot', 'bar']).optional()
          .describe('Cap rendered at the target end. Default: "triangle".'),
        arrowTail: z.enum(['none', 'triangle', 'arrow', 'dot', 'bar']).optional()
          .describe('Cap rendered at the source end. Default: "none".'),
        color: z.string().optional().describe('Stroke color (hex, e.g. "#1f2328").'),
        width: z.number().optional().describe('Stroke width in px. Default 2.4.'),
        style: z.enum(['solid', 'dashed', 'dotted']).optional().describe('Stroke dash style. Default "solid".'),
        bend: z.number().optional().describe('Perpendicular peak offset of the curve. 0 (default) = straight line.'),
        kind: z.string().optional().describe('Optional semantic tag (e.g. "depends-on", "references").'),
        payload: z.record(z.string(), z.unknown()).optional().describe('Free-form extra data attached to the edge.'),
      }),
      execute: async (input) => {
        let source: EdgeEndpoint;
        let target: EdgeEndpoint;
        try {
          source = buildEndpoint({
            nodeId: input.sourceNodeId as string | undefined,
            anchor: input.sourceAnchor as string | undefined,
            x: input.sourceX as number | undefined,
            y: input.sourceY as number | undefined,
            which: 'source',
          });
          target = buildEndpoint({
            nodeId: input.targetNodeId as string | undefined,
            anchor: input.targetAnchor as string | undefined,
            x: input.targetX as number | undefined,
            y: input.targetY as number | undefined,
            which: 'target',
          });
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        // Validate referenced nodes exist before committing — otherwise the
        // agent could create a zombie edge pointing at a deleted node id.
        if (source.kind === 'node' && !canvas.nodes.some((n) => n.id === source.nodeId)) {
          return `Error: source node not found: ${source.nodeId}`;
        }
        if (target.kind === 'node' && !canvas.nodes.some((n) => n.id === target.nodeId)) {
          return `Error: target node not found: ${target.nodeId}`;
        }

        const stroke: EdgeStroke | undefined =
          input.color != null || input.width != null || input.style != null
            ? {
                color: (input.color as string | undefined) ?? '#1f2328',
                width: (input.width as number | undefined) ?? 2.4,
                style: (input.style as 'solid' | 'dashed' | 'dotted' | undefined) ?? 'solid',
              }
            : undefined;

        const edge: CanvasEdge = {
          id: genEdgeId(),
          source,
          target,
          bend: (input.bend as number | undefined) ?? 0,
          arrowHead: (input.arrowHead as EdgeArrowCap | undefined) ?? 'triangle',
          arrowTail: (input.arrowTail as EdgeArrowCap | undefined) ?? 'none',
          stroke,
          label: input.label as string | undefined,
          kind: input.kind as string | undefined,
          payload: input.payload as Record<string, unknown> | undefined,
          updatedAt: Date.now(),
        };

        const fresh = (await loadCanvas(workspaceId)) ?? canvas;
        fresh.edges = [...(fresh.edges ?? []), edge];
        await saveCanvas(workspaceId, fresh);

        // Broadcast using the endpoint node IDs so the renderer highlights
        // them as "recently changed". Edges with two free-point endpoints
        // still trigger a reload via any existing node id on the canvas;
        // if none exist we skip — the renderer only re-reads when at least
        // one node id is supplied, which is fine for a canvas with zero nodes.
        const touchedIds = [source, target]
          .filter((ep): ep is Extract<EdgeEndpoint, { kind: 'node' }> => ep.kind === 'node')
          .map((ep) => ep.nodeId);
        if (touchedIds.length === 0 && fresh.nodes.length > 0) {
          // Two free-point endpoints — nudge the renderer by referencing any
          // node so it re-reads edges from disk.
          touchedIds.push(fresh.nodes[0].id);
        }
        if (touchedIds.length > 0) broadcastUpdate(workspaceId, touchedIds);

        return JSON.stringify({ ok: true, edgeId: edge.id });
      },
    },

    canvas_update_edge: {
      name: 'canvas_update_edge',
      defer_loading: true,
      description:
        'Update fields on an existing edge. Supports changing label, kind, payload, arrow caps, stroke, and bend. ' +
        'Endpoint mutation is intentionally not supported — delete the edge and create a new one instead to keep the ' +
        'semantics obvious in the undo history.',
      inputSchema: z.object({
        edgeId: z.string().describe('The ID of the edge to update.'),
        label: z.string().optional(),
        kind: z.string().optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
        arrowHead: z.enum(['none', 'triangle', 'arrow', 'dot', 'bar']).optional(),
        arrowTail: z.enum(['none', 'triangle', 'arrow', 'dot', 'bar']).optional(),
        color: z.string().optional(),
        width: z.number().optional(),
        style: z.enum(['solid', 'dashed', 'dotted']).optional(),
        bend: z.number().optional(),
      }),
      execute: async (input) => {
        const edgeId = input.edgeId as string;

        // Single read against the latest disk state. Building `next` from
        // a stale copy and splicing it into a freshly-read canvas would
        // silently overwrite any concurrent writer's changes to other
        // fields of the same edge; falling back to `push(next)` when the
        // edge was deleted between the two reads would also resurrect a
        // just-deleted edge. Read once, derive `next` from the live
        // version, and bail if the edge is gone.
        const fresh = await loadCanvas(workspaceId);
        if (!fresh) return 'Error: workspace not found';
        const freshEdges = [...(fresh.edges ?? [])];
        const freshIdx = freshEdges.findIndex((e) => e.id === edgeId);
        if (freshIdx === -1) return `Error: edge not found: ${edgeId}`;
        const existing = freshEdges[freshIdx];

        const nextStroke =
          input.color != null || input.width != null || input.style != null
            ? {
                color: (input.color as string | undefined) ?? existing.stroke?.color ?? '#1f2328',
                width: (input.width as number | undefined) ?? existing.stroke?.width ?? 2.4,
                style:
                  (input.style as 'solid' | 'dashed' | 'dotted' | undefined) ??
                  existing.stroke?.style ??
                  'solid',
              }
            : existing.stroke;
        const next: CanvasEdge = {
          ...existing,
          label: input.label !== undefined ? (input.label as string) : existing.label,
          kind: input.kind !== undefined ? (input.kind as string) : existing.kind,
          payload:
            input.payload !== undefined
              ? (input.payload as Record<string, unknown>)
              : existing.payload,
          arrowHead: (input.arrowHead as EdgeArrowCap | undefined) ?? existing.arrowHead,
          arrowTail: (input.arrowTail as EdgeArrowCap | undefined) ?? existing.arrowTail,
          stroke: nextStroke,
          bend: input.bend != null ? (input.bend as number) : existing.bend,
          updatedAt: Date.now(),
        };

        freshEdges[freshIdx] = next;
        fresh.edges = freshEdges;
        await saveCanvas(workspaceId, fresh);

        const touchedIds = [next.source, next.target]
          .filter((ep): ep is Extract<EdgeEndpoint, { kind: 'node' }> => ep.kind === 'node')
          .map((ep) => ep.nodeId);
        if (touchedIds.length === 0 && fresh.nodes.length > 0) {
          touchedIds.push(fresh.nodes[0].id);
        }
        if (touchedIds.length > 0) broadcastUpdate(workspaceId, touchedIds);

        return JSON.stringify({ ok: true, edgeId });
      },
    },

    canvas_delete_edge: {
      name: 'canvas_delete_edge',
      defer_loading: true,
      description: 'Delete an edge by id.',
      inputSchema: z.object({
        edgeId: z.string().describe('The ID of the edge to delete.'),
      }),
      execute: async (input) => {
        const edgeId = input.edgeId as string;
        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';
        const existing = (canvas.edges ?? []).find((e) => e.id === edgeId);
        if (!existing) return `Error: edge not found: ${edgeId}`;

        const fresh = (await loadCanvas(workspaceId)) ?? canvas;
        fresh.edges = (fresh.edges ?? []).filter((e) => e.id !== edgeId);
        await saveCanvas(workspaceId, fresh);

        const touchedIds = [existing.source, existing.target]
          .filter((ep): ep is Extract<EdgeEndpoint, { kind: 'node' }> => ep.kind === 'node')
          .map((ep) => ep.nodeId);
        if (touchedIds.length === 0 && fresh.nodes.length > 0) {
          touchedIds.push(fresh.nodes[0].id);
        }
        if (touchedIds.length > 0) broadcastUpdate(workspaceId, touchedIds);

        return JSON.stringify({ ok: true, edgeId });
      },
    },
  };
}
