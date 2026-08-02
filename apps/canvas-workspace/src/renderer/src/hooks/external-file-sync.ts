import type { CanvasNode, FileNodeData } from '../types';

export interface FileChangeMergeResult {
  nodes: CanvasNode[];
  changedIds: string[];
}

/**
 * Merge an external file change (agent CLI, another editor) into the
 * in-memory nodes. Returns null when nothing needs to change so callers
 * can skip state churn entirely.
 *
 * Rules, in order, per file node bound to `filePath`:
 * - `modified` nodes are untouched — committed-but-unsaved local edits
 *   always win over the disk version.
 * - identical content is a no-op — this absorbs the watcher echo of our
 *   own `persistToFile` write.
 * - otherwise the disk content is adopted with a fresh `updatedAt`, and
 *   `saved`/`modified` mirror the post-persist state (content == disk).
 */
export const mergeExternalFileChange = (
  current: readonly CanvasNode[],
  filePath: string,
  content: string,
  now: number = Date.now(),
): FileChangeMergeResult | null => {
  const changedIds: string[] = [];
  const nodes = current.map((node) => {
    if (node.type !== 'file') return node;
    const data = node.data as FileNodeData;
    if (data.filePath !== filePath) return node;
    if (data.modified) return node;
    if (data.content === content) return node;
    changedIds.push(node.id);
    return {
      ...node,
      data: { ...data, content, saved: true, modified: false },
      updatedAt: now,
    };
  });
  return changedIds.length > 0 ? { nodes, changedIds } : null;
};
