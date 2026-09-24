import type { EntityRecord, FileWriteRecord, PulseStorage } from '@pulse-coder/storage';
import { prepareLocalFileWrite, recoverLocalFileWrites } from '@pulse-coder/storage/local-files';
import { isPathInside } from './nodes';
import type { DoctorFinding, DoctorReport } from './doctor';

async function outstandingWrites(storage: PulseStorage, workspaceId: string): Promise<FileWriteRecord[]> {
  const records: FileWriteRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.fileWrites.list({ workspaceId, statuses: ['pending', 'error', 'conflict'], cursor, limit: 500 });
    records.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return records;
}

export async function inspectSqliteCanvas(
  storage: PulseStorage,
  workspaceId: string,
  workspaceDir: string,
  repair: boolean,
): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  const integrity = await storage.checkIntegrity();
  for (const issue of integrity.issues) {
    findings.push({ kind: 'storage_integrity', detail: `SQLite integrity: ${issue}`, repairable: false });
  }
  const before = await outstandingWrites(storage, workspaceId);
  if (repair && integrity.ok) await recoverLocalFileWrites(storage, { workspaceId });
  const pending: FileWriteRecord[] = [];
  for (const previous of before) {
    const current = await storage.fileWrites.get(previous.id);
    if (!current) continue;
    const applied = current.status === 'applied';
    if (!applied) pending.push(current);
    findings.push({
      kind: previous.status === 'conflict' ? 'file_write_conflict'
        : previous.status === 'error' ? 'file_write_error' : 'file_write_pending',
      nodeId: current.nodeId,
      intentId: current.id,
      fileWriteStatus: current.status,
      detail: `File write ${current.id}: ${current.status}${current.error ? ` — ${current.error}` : ''}. Base and requested snapshots are retained.`,
      repairable: current.status !== 'conflict' && integrity.ok,
      ...(applied ? { repaired: true } : {}),
    });
  }
  const snapshot = await storage.canvas.read(workspaceId);
  if (!snapshot) return {
    workspaceId, schemaVersion: 3, checkedNodes: 0, checkedEdges: 0,
    findings, repairedCount: findings.filter(finding => finding.repaired).length,
    repairableCount: findings.filter(finding => finding.repairable).length,
  };
  const activeIntents = new Set(pending.map(write => write.id));
  const updates: Array<{ record: EntityRecord; path: string; version: string; finding: DoctorFinding }> = [];
  for (const node of snapshot.nodes) {
    const data = node.data;
    if (node.type !== 'file') continue;
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || typeof data.filePath !== 'string' || !data.filePath) {
      findings.push({ kind: 'missing_backing_file', nodeId: node.id,
        detail: 'File node has no valid source-file binding; cached content is retained for inspection.', repairable: false });
      continue;
    }
    const path = data.filePath;
    if (!isPathInside(path, workspaceDir)) {
      findings.push({ kind: 'path_outside_workspace', nodeId: node.id, path,
        detail: 'File index points outside the workspace; no automatic index repair.', repairable: false });
      continue;
    }
    let source: Awaited<ReturnType<typeof prepareLocalFileWrite>>;
    try {
      source = await prepareLocalFileWrite(path, node.id, typeof data.content === 'string' ? data.content : '');
    } catch (error) {
      findings.push({ kind: 'missing_backing_file', nodeId: node.id, path,
        detail: `Source is unavailable or is not a regular UTF-8 file: ${error instanceof Error ? error.message : String(error)}`, repairable: false });
      continue;
    }
    if (source.baseContent === null || source.baseVersion === null) {
      findings.push({ kind: 'missing_backing_file', nodeId: node.id, path,
        detail: 'Source Markdown is missing; cached index content is not used to manufacture a replacement.', repairable: false });
      continue;
    }
    if (source.baseContent === data.content) continue;
    const hasUnresolvedIntent = typeof data.fileWriteIntentId === 'string'
      && (activeIntents.has(data.fileWriteIntentId) || data.fileWriteStatus !== 'applied');
    const finding: DoctorFinding = {
      kind: 'content_drift', nodeId: node.id, path,
      detail: hasUnresolvedIntent
        ? 'Markdown differs from an unresolved file intent; the source and recovery snapshots are preserved.'
        : 'Markdown differs from its content index; repair refreshes only the index from the regular source file.',
      repairable: !hasUnresolvedIntent && integrity.ok,
    };
    findings.push(finding);
    if (repair && finding.repairable) {
      updates.push({
        record: { ...node, data: { ...data, content: source.baseContent, saved: true, modified: false }, updatedAt: Date.now() },
        path, version: source.baseVersion, finding,
      });
    }
  }
  const placedIds = new Set(snapshot.placements.map(node => node.id));
  const atomIds = new Set(snapshot.nodes.map(node => node.id));
  for (const placement of snapshot.placements) {
    if (!atomIds.has(placement.id) && !(placement.type === 'reference' && placement.ref != null)) {
      findings.push({ kind: 'missing_atom', nodeId: placement.id,
        detail: 'The canvas placement has no backing knowledge record; no empty replacement is synthesized.', repairable: false });
    }
  }
  const removedEdges: string[] = [];
  const edgeFindings: DoctorFinding[] = [];
  for (const edge of snapshot.edges) {
    const missing = [edge.source, edge.target].find(endpoint => endpoint && typeof endpoint === 'object'
      && !Array.isArray(endpoint) && endpoint.kind === 'node' && typeof endpoint.nodeId === 'string'
      && !placedIds.has(endpoint.nodeId));
    if (!missing) continue;
    const finding: DoctorFinding = { kind: 'dangling_edge', edgeId: edge.id,
      detail: `Edge ${edge.id} references a missing canvas placement.`, repairable: integrity.ok };
    findings.push(finding);
    if (repair && integrity.ok) {
      removedEdges.push(edge.id);
      edgeFindings.push(finding);
    }
  }
  const stableUpdates: typeof updates = [];
  for (const update of updates) {
    try {
      const checked = await prepareLocalFileWrite(update.path, update.record.id, '', update.version);
      if (checked.baseVersion === update.version) stableUpdates.push(update);
    } catch {
      update.finding.repairable = false;
      update.finding.detail += ' Source changed or became unavailable during repair; the index was left untouched.';
    }
  }
  let revision = snapshot.revision;
  if (stableUpdates.length || removedEdges.length) {
    const receipt = await storage.canvas.commit({
      workspaceId, expectedGeneration: snapshot.generation, expectedRevision: snapshot.revision,
      nodes: { put: stableUpdates.map(update => update.record) },
      edges: { remove: removedEdges },
    });
    revision = receipt.revision;
    for (const update of stableUpdates) update.finding.repaired = true;
    for (const finding of edgeFindings) finding.repaired = true;
  }
  return {
    workspaceId, schemaVersion: 3, revision,
    checkedNodes: snapshot.nodes.length, checkedEdges: snapshot.edges.length, findings,
    repairedCount: findings.filter(finding => finding.repaired).length,
    repairableCount: findings.filter(finding => finding.repairable).length,
  };
}
