import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import {
  loadCanvas,
  saveCanvas,
  getWorkspaceDir,
  withWorkspaceLock,
} from './store';
import {
  getNodesDir,
  getNodeFilePath,
  listNodeFiles,
  readNodeFile,
  detectSchemaVersion,
  PER_NODE_SCHEMA_VERSION,
} from './storage-v2';
import { isPathInside } from './nodes';
import { DEFAULT_NODE_DIMENSIONS } from './constants';
import type { CanvasEdge, CanvasNode, CanvasSaveData } from './types';

/**
 * `pulse-canvas doctor` — workspace consistency checker + safe repairer.
 *
 * Exists because the storage layer holds the same truth in more than one
 * place (file-node markdown ↔ `data.content`; v2 layout ↔ `nodes/<id>.json`)
 * and a crashed or (historically) racing writer could leave them divergent:
 * cards rendering empty while the markdown still has the body, per-node
 * files with no layout entry, edges pointing at deleted nodes.
 *
 * Repair policy, deliberately conservative:
 *   - Markdown is the winner on content drift (it is the user-visible,
 *     user-editable copy); `data.content` is realigned to it.
 *   - Orphan per-node files are ADOPTED back into the layout, never deleted
 *     (deletion is what the old orphan sweep got wrong; anything adopted is
 *     visible and deletable in the UI).
 *   - Anything ambiguous (both copies empty, path escapes the workspace,
 *     unknown schema) is reported, not touched.
 */

export type DoctorFindingKind =
  | 'content_drift'
  | 'missing_backing_file'
  | 'path_outside_workspace'
  | 'missing_node_file'
  | 'orphan_node_file'
  | 'unreadable_node_file'
  | 'dangling_edge'
  | 'empty_body'
  | 'schema_mismatch'
  | 'stale_tmp';

export interface DoctorFinding {
  kind: DoctorFindingKind;
  nodeId?: string;
  edgeId?: string;
  path?: string;
  detail: string;
  repairable: boolean;
  repaired?: boolean;
}

export interface DoctorReport {
  workspaceId: string;
  schemaVersion: 1 | 2;
  checkedNodes: number;
  checkedEdges: number;
  findings: DoctorFinding[];
  repairedCount: number;
  repairableCount: number;
}

export interface DoctorOptions {
  repair?: boolean;
  storeDir?: string;
}

/** Leftover tmp files younger than this may belong to an in-flight writer. */
const STALE_TMP_AGE_MS = 60 * 60 * 1000;

const isBlank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';

function isLayoutOnlyReference(node: CanvasNode): boolean {
  return node.type === 'reference' && (node as { ref?: unknown }).ref != null;
}

export async function runDoctor(
  workspaceId: string,
  opts: DoctorOptions = {},
): Promise<DoctorReport> {
  const run = () => analyzeAndMaybeRepair(workspaceId, opts);
  // Check mode reads without the lock (a torn read at worst mis-reports once);
  // repair mode must hold the workspace lock for its whole read→fix→save
  // cycle, and therefore must NOT call any helper that re-acquires it.
  return opts.repair
    ? withWorkspaceLock(workspaceId, opts.storeDir, run)
    : run();
}

async function analyzeAndMaybeRepair(
  workspaceId: string,
  opts: DoctorOptions,
): Promise<DoctorReport> {
  const repair = opts.repair === true;
  const storeDir = opts.storeDir;
  const wsDir = getWorkspaceDir(workspaceId, storeDir);
  const findings: DoctorFinding[] = [];

  // Schema detection from the raw file — loadCanvas strips the marker.
  let schemaVersion: 1 | 2 = 1;
  try {
    schemaVersion = detectSchemaVersion(
      JSON.parse(await fs.readFile(join(wsDir, 'canvas.json'), 'utf-8')),
    );
  } catch {
    // Unreadable primary: loadCanvas below may still recover via .bak; fall
    // back to the nodes/ dir as the v2 tell.
    schemaVersion = (await fs.access(getNodesDir(wsDir)).then(() => true).catch(() => false)) ? 2 : 1;
  }

  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) {
    return {
      workspaceId,
      schemaVersion,
      checkedNodes: 0,
      checkedEdges: 0,
      findings,
      repairedCount: 0,
      repairableCount: 0,
    };
  }

  let canvasChanged = false;

  // ── v2 layout ↔ per-node file reconciliation ──────────────────────────
  if (schemaVersion === 2) {
    const layoutIds = new Set(canvas.nodes.map(n => n.id));
    const onDiskIds = await listNodeFiles(wsDir);
    const onDisk = new Set(onDiskIds);

    for (const node of canvas.nodes) {
      if (isLayoutOnlyReference(node)) continue;
      if (!onDisk.has(node.id)) {
        // The save below re-splits every node, materializing the file again.
        findings.push({
          kind: 'missing_node_file',
          nodeId: node.id,
          detail: `layout lists "${node.title ?? node.id}" but nodes/${node.id}.json is missing; its content is gone (a stub will be rewritten on repair)`,
          repairable: true,
          ...(repair ? { repaired: true } : {}),
        });
        if (repair) canvasChanged = true;
      }
    }

    for (const id of onDiskIds) {
      if (layoutIds.has(id)) continue;
      const file = await readNodeFile(wsDir, id);
      if (!file) {
        findings.push({
          kind: 'unreadable_node_file',
          nodeId: id,
          path: getNodeFilePath(wsDir, id),
          detail: `nodes/${id}.json exists but cannot be parsed`,
          repairable: false,
        });
        continue;
      }
      if (file.schemaVersion !== PER_NODE_SCHEMA_VERSION) {
        findings.push({
          kind: 'schema_mismatch',
          nodeId: id,
          detail: `nodes/${id}.json has schemaVersion ${String(file.schemaVersion)} (expected ${PER_NODE_SCHEMA_VERSION})`,
          repairable: false,
        });
      }
      // Orphan: real node content with no layout entry — typically the
      // surviving half of a lost concurrent write. Adopt, never delete.
      const finding: DoctorFinding = {
        kind: 'orphan_node_file',
        nodeId: id,
        detail: `nodes/${id}.json ("${file.title ?? id}", type ${file.type}) has no layout entry`,
        repairable: true,
      };
      if (repair) {
        const def = (DEFAULT_NODE_DIMENSIONS as Record<string, { width: number; height: number }>)[file.type]
          ?? { width: 420, height: 240 };
        const maxBottom = canvas.nodes.reduce(
          (m, n) => Math.max(m, (n.y ?? 0) + (n.height ?? 0)),
          0,
        );
        canvas.nodes.push({
          id: file.id,
          type: file.type,
          title: file.title ?? file.id,
          x: 100,
          y: maxBottom + 80,
          width: def.width,
          height: def.height,
          data: file.data,
          updatedAt: file.updatedAt ?? Date.now(),
        } as CanvasNode);
        canvasChanged = true;
        finding.repaired = true;
      }
      findings.push(finding);
    }

    // Tmp litter old enough that no live writer can still own it.
    try {
      const entries = await fs.readdir(getNodesDir(wsDir));
      for (const name of entries) {
        if (!name.endsWith('.tmp')) continue;
        const path = join(getNodesDir(wsDir), name);
        let stale = false;
        try {
          stale = Date.now() - (await fs.stat(path)).mtimeMs > STALE_TMP_AGE_MS;
        } catch {
          continue;
        }
        if (!stale) continue;
        const finding: DoctorFinding = {
          kind: 'stale_tmp',
          path,
          detail: `stale write artifact nodes/${name}`,
          repairable: true,
        };
        if (repair) {
          await fs.unlink(path).catch(() => undefined);
          finding.repaired = true;
        }
        findings.push(finding);
      }
    } catch {
      // nodes/ unreadable — the checks above already surfaced what they could.
    }
  }

  // ── file-node markdown ↔ data.content ────────────────────────────────
  for (const node of canvas.nodes) {
    if (node.type === 'file' && typeof node.data.filePath === 'string' && node.data.filePath) {
      const filePath = node.data.filePath;
      if (!isPathInside(filePath, wsDir)) {
        findings.push({
          kind: 'path_outside_workspace',
          nodeId: node.id,
          path: filePath,
          detail: `file node "${node.title ?? node.id}" points outside the workspace; not touched`,
          repairable: false,
        });
        continue;
      }
      let md: string | null = null;
      try {
        md = await fs.readFile(filePath, 'utf-8');
      } catch {
        md = null;
      }
      if (md === null) {
        const finding: DoctorFinding = {
          kind: 'missing_backing_file',
          nodeId: node.id,
          path: filePath,
          detail: `backing markdown for "${node.title ?? node.id}" is missing`,
          repairable: !isBlank(node.data.content),
        };
        if (repair && finding.repairable) {
          await fs.mkdir(dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, String(node.data.content), 'utf-8');
          finding.repaired = true;
        }
        findings.push(finding);
        continue;
      }
      const inline = typeof node.data.content === 'string' ? node.data.content : '';
      if (md !== inline) {
        // Markdown wins: it is the copy the user sees and edits on disk. The
        // empty-card incident is exactly this state (md full, content '').
        const finding: DoctorFinding = {
          kind: 'content_drift',
          nodeId: node.id,
          path: filePath,
          detail: `"${node.title ?? node.id}": markdown (${md.length} chars) and data.content (${inline.length} chars) disagree; markdown wins on repair`,
          repairable: true,
        };
        if (repair) {
          node.data.content = md;
          node.updatedAt = Date.now();
          canvasChanged = true;
          finding.repaired = true;
        }
        findings.push(finding);
      }
    }

    if ((node.type === 'file' || node.type === 'text') && isBlank(node.data.content)) {
      const hasBackingContent =
        node.type === 'file'
        && typeof node.data.filePath === 'string'
        && findings.some(f => f.nodeId === node.id && (f.kind === 'content_drift' || f.kind === 'missing_backing_file') && f.repairable);
      if (!hasBackingContent) {
        findings.push({
          kind: 'empty_body',
          nodeId: node.id,
          detail: `${node.type} node "${node.title ?? node.id}" has no content anywhere; nothing to recover`,
          repairable: false,
        });
      }
    }
  }

  // ── dangling edges ────────────────────────────────────────────────────
  const nodeIds = new Set(canvas.nodes.map(n => n.id));
  const edges = canvas.edges ?? [];
  // Point endpoints are free-floating by design; only node endpoints dangle.
  const danglingNodeId = (ep: CanvasEdge['source']): string | null =>
    ep && ep.kind === 'node' && !nodeIds.has(ep.nodeId) ? ep.nodeId : null;
  const keptEdges = edges.filter(edge => {
    const missing = danglingNodeId(edge.source) ?? danglingNodeId(edge.target);
    if (missing === null) return true;
    findings.push({
      kind: 'dangling_edge',
      edgeId: edge.id,
      detail: `edge ${edge.id} references missing node ${missing}`,
      repairable: true,
      ...(repair ? { repaired: true } : {}),
    });
    return !repair;
  });
  if (repair && keptEdges.length !== edges.length) {
    canvas.edges = keptEdges;
    canvasChanged = true;
  }

  if (repair && canvasChanged) {
    // One save for the whole repair pass; we are inside the workspace lock.
    // Never prune unknown node files here — adoption above is the answer.
    await saveCanvas(workspaceId, canvas as CanvasSaveData, storeDir, { allowEmpty: true });
  }

  return {
    workspaceId,
    schemaVersion,
    checkedNodes: canvas.nodes.length,
    checkedEdges: edges.length,
    findings,
    repairedCount: findings.filter(f => f.repaired).length,
    repairableCount: findings.filter(f => f.repairable).length,
  };
}
