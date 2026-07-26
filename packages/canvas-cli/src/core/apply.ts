import { promises as fs } from 'fs';
import { dirname } from 'path';
import {
  loadCanvas,
  saveCanvas,
  getWorkspaceDir,
  withWorkspaceLock,
} from './store';
import {
  autoPlace,
  genNodeId,
  buildInitialNodeData,
  buildNoteFilePath,
  prepareNodeContent,
  type PreparedContentWrite,
} from './nodes';
import { isSafeNodeId } from './storage-v2';
import { DEFAULT_NODE_DIMENSIONS } from './constants';
import { notifyCanvasUpdated } from './notifier';
import type { CanvasEdge, CanvasNode, NodeType, Result } from './types';

/**
 * `pulse-canvas apply` — atomic batch mutation from a plan file.
 *
 * One plan = one lock acquisition = one canvas save. Ops are validated and
 * applied against an in-memory copy first; every fs side effect (backing
 * markdown files) is DEFERRED until the whole plan validates, so a failing
 * op aborts with zero on-disk changes. `baseRevision` gives optimistic
 * concurrency against other CLI writers (see CanvasSaveData.revision).
 */

export interface ApplyCreateNodeOp {
  action: 'create';
  type: NodeType;
  id?: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  data?: Record<string, unknown>;
  /** Body for file/text nodes; file nodes get a backing markdown file. */
  content?: string;
}

export interface ApplyUpdateNodeOp {
  action: 'update';
  id: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Same per-type semantics as `node write` (file → markdown + data.content,
   * text → data.content, frame/group → JSON label/color patch). */
  content?: string;
}

export interface ApplyDeleteNodeOp {
  action: 'delete';
  id: string;
}

export interface ApplyCreateEdgeOp {
  action: 'createEdge';
  id?: string;
  from: string;
  to: string;
  label?: string;
  labelStyle?: CanvasEdge['labelStyle'];
  kind?: string;
  bend?: number;
}

export interface ApplyDeleteEdgeOp {
  action: 'deleteEdge';
  id: string;
}

export type ApplyOperation =
  | ApplyCreateNodeOp
  | ApplyUpdateNodeOp
  | ApplyDeleteNodeOp
  | ApplyCreateEdgeOp
  | ApplyDeleteEdgeOp;

export interface CanvasPlan {
  /** Optional pin: must match the resolved workspace when present. */
  workspace?: string;
  /** Optimistic concurrency: reject when the on-disk revision differs. */
  baseRevision?: number;
  operations: ApplyOperation[];
}

export interface ApplyReport {
  workspaceId: string;
  dryRun: boolean;
  /** Revision after the save (dry-run: current on-disk revision, unchanged). */
  revision: number | null;
  created: string[];
  updated: string[];
  deleted: string[];
  edgesCreated: string[];
  edgesDeleted: string[];
  /** Edges dropped because a deleted node was one of their endpoints. */
  prunedEdges: string[];
}

export interface ApplyOptions {
  dryRun?: boolean;
  storeDir?: string;
  confineToWorkspace?: boolean;
}

const fail = (error: string, code: string): Result<never> => ({ ok: false, error, code });

const opFail = (index: number, action: string, error: string, code: string): Result<never> =>
  fail(`operation[${index}] (${action}): ${error}`, code);

export async function applyPlan(
  workspaceId: string,
  plan: CanvasPlan,
  opts: ApplyOptions = {},
): Promise<Result<ApplyReport>> {
  if (plan.workspace && plan.workspace !== workspaceId) {
    return fail(
      `Plan is pinned to workspace "${plan.workspace}" but the resolved target is "${workspaceId}". ` +
      'Pass the matching --workspace or fix the plan.',
      'workspace_mismatch',
    );
  }
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    return fail('Plan has no operations.', 'invalid_argument');
  }

  return withWorkspaceLock(workspaceId, opts.storeDir, async () => {
    const canvas = await loadCanvas(workspaceId, opts.storeDir);
    if (!canvas) return fail(`Workspace not found: ${workspaceId}`, 'workspace_not_found');

    const currentRevision = typeof canvas.revision === 'number' ? canvas.revision : null;
    if (plan.baseRevision !== undefined) {
      if (currentRevision === null) {
        return fail(
          `Plan requires baseRevision ${plan.baseRevision} but the canvas carries no revision yet ` +
          '(no CLI write has stamped one). Re-read the canvas and omit baseRevision, or perform one ' +
          'CLI write first to establish it.',
          'revision_conflict',
        );
      }
      if (currentRevision !== plan.baseRevision) {
        return fail(
          `Revision conflict: plan expects ${plan.baseRevision}, canvas is at ${currentRevision}. ` +
          'Re-read the canvas and rebuild the plan.',
          'revision_conflict',
        );
      }
    }

    const wsDir = getWorkspaceDir(workspaceId, opts.storeDir);
    const report: ApplyReport = {
      workspaceId,
      dryRun: opts.dryRun === true,
      revision: currentRevision,
      created: [],
      updated: [],
      deleted: [],
      edgesCreated: [],
      edgesDeleted: [],
      prunedEdges: [],
    };
    const pendingWrites: PreparedContentWrite[] = [];
    const removedIds: string[] = [];
    const edges = (canvas.edges ??= []);

    for (let i = 0; i < plan.operations.length; i++) {
      const op = plan.operations[i];
      switch (op.action) {
        case 'create': {
          const def = (DEFAULT_NODE_DIMENSIONS as Record<string, { title: string; width: number; height: number }>)[op.type];
          if (!def) return opFail(i, op.action, `Unsupported node type: ${op.type}`, 'unsupported');
          const id = op.id ?? genNodeId();
          if (!isSafeNodeId(id)) return opFail(i, op.action, `Unsafe node id: ${JSON.stringify(id)}`, 'invalid_argument');
          if (canvas.nodes.some(n => n.id === id)) {
            return opFail(i, op.action, `Node already exists: ${id}`, 'invalid_argument');
          }
          const nodeData = buildInitialNodeData(op.type, op.data ?? {}, op.title ?? '');
          if (op.content !== undefined && (op.type === 'file' || op.type === 'text')) {
            nodeData.content = op.content;
          }
          if (op.type === 'file') {
            const noteFile = buildNoteFilePath(wsDir, op.title ?? def.title, id);
            pendingWrites.push({ path: noteFile, content: String(nodeData.content ?? '') });
            nodeData.filePath = noteFile;
            nodeData.saved = true;
            nodeData.modified = false;
          }
          const auto = autoPlace(canvas.nodes);
          canvas.nodes.push({
            id,
            type: op.type,
            title: op.title ?? def.title,
            x: op.x ?? auto.x,
            y: op.y ?? auto.y,
            width: op.width ?? def.width,
            height: op.height ?? def.height,
            data: nodeData,
            updatedAt: Date.now(),
          } as CanvasNode);
          report.created.push(id);
          break;
        }
        case 'update': {
          const node = canvas.nodes.find(n => n.id === op.id);
          if (!node) return opFail(i, op.action, `Node not found: ${op.id}`, 'node_not_found');
          if (op.x !== undefined) node.x = op.x;
          if (op.y !== undefined) node.y = op.y;
          if (op.width !== undefined) node.width = op.width;
          if (op.height !== undefined) node.height = op.height;
          if (op.title !== undefined) node.title = op.title;
          if (op.content !== undefined) {
            const prep = prepareNodeContent(node, op.content, wsDir, {
              confineToWorkspace: opts.confineToWorkspace,
            });
            if (!prep.ok) return opFail(i, op.action, prep.error, prep.code ?? 'error');
            if (prep.data.fileWrite) pendingWrites.push(prep.data.fileWrite);
          }
          node.updatedAt = Date.now();
          report.updated.push(op.id);
          break;
        }
        case 'delete': {
          const idx = canvas.nodes.findIndex(n => n.id === op.id);
          if (idx === -1) return opFail(i, op.action, `Node not found: ${op.id}`, 'node_not_found');
          canvas.nodes.splice(idx, 1);
          removedIds.push(op.id);
          report.deleted.push(op.id);
          // Edges pointing at the deleted node go with it.
          for (let e = edges.length - 1; e >= 0; e--) {
            const edge = edges[e];
            const touches = (ep: CanvasEdge['source']): boolean =>
              !!ep && ep.kind === 'node' && ep.nodeId === op.id;
            if (touches(edge.source) || touches(edge.target)) {
              report.prunedEdges.push(edge.id);
              edges.splice(e, 1);
            }
          }
          break;
        }
        case 'createEdge': {
          const missing = [op.from, op.to].find(id => !canvas.nodes.some(n => n.id === id));
          if (missing) return opFail(i, op.action, `Edge endpoint not found: ${missing}`, 'node_not_found');
          const id = op.id ?? `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          if (edges.some(e => e.id === id)) {
            return opFail(i, op.action, `Edge already exists: ${id}`, 'invalid_argument');
          }
          const edge: CanvasEdge = {
            id,
            source: { kind: 'node', nodeId: op.from },
            target: { kind: 'node', nodeId: op.to },
            updatedAt: Date.now(),
          };
          if (op.label !== undefined) edge.label = op.label;
          if (op.labelStyle !== undefined) edge.labelStyle = op.labelStyle;
          if (op.kind !== undefined) edge.kind = op.kind;
          if (op.bend !== undefined) edge.bend = op.bend;
          edges.push(edge);
          report.edgesCreated.push(id);
          break;
        }
        case 'deleteEdge': {
          const idx = edges.findIndex(e => e.id === op.id);
          if (idx === -1) return opFail(i, op.action, `Edge not found: ${op.id}`, 'edge_not_found');
          edges.splice(idx, 1);
          report.edgesDeleted.push(op.id);
          break;
        }
        default:
          return opFail(i, (op as { action?: string }).action ?? 'unknown', 'Unknown action', 'invalid_argument');
      }
    }

    if (opts.dryRun) return { ok: true as const, data: report };

    // Whole plan validated — now the effects, then ONE save.
    for (const write of pendingWrites) {
      await fs.mkdir(dirname(write.path), { recursive: true });
      await fs.writeFile(write.path, write.content, 'utf-8');
    }
    canvas.savedAt = new Date().toISOString();
    await saveCanvas(workspaceId, canvas, opts.storeDir, {
      allowEmpty: true,
      removedIds,
    });
    report.revision = typeof canvas.revision === 'number' ? canvas.revision : null;

    const touched = [...report.created, ...report.updated, ...report.deleted];
    await notifyCanvasUpdated({ workspaceId, nodeIds: touched, kind: 'update' });

    return { ok: true as const, data: report };
  });
}
