import type { CanvasNode } from '../../../types';

export interface NodeUpdateOperation {
  action: 'update';
  id: string;
  width?: number;
  height?: number;
  data?: Record<string, unknown>;
}

const sameValue = (left: unknown, right: unknown): boolean =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

/**
 * Turn a node body's `onUpdate` patch into the smallest `canvas_apply`
 * update: changed size plus changed `writableFields` (as reported by the
 * server's `canvas_ui_node`, the single owner of that list). Anything else a
 * body changes stays local because the store refuses it. Returns null when
 * nothing persistable changed.
 */
export function toUpdateOperation(
  node: CanvasNode,
  patch: Partial<CanvasNode>,
  writableFields: readonly string[],
): NodeUpdateOperation | null {
  const operation: NodeUpdateOperation = { action: 'update', id: node.id };
  if (typeof patch.width === 'number' && patch.width !== node.width) operation.width = Math.round(patch.width);
  if (typeof patch.height === 'number' && patch.height !== node.height) operation.height = Math.round(patch.height);

  const nextData = patch.data as Record<string, unknown> | undefined;
  if (nextData) {
    const current = node.data as unknown as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const field of writableFields) {
      if (field in nextData && !sameValue(nextData[field], current[field])) data[field] = nextData[field];
    }
    if (Object.keys(data).length > 0) operation.data = data;
  }
  return operation.width === undefined && operation.height === undefined && !operation.data
    ? null
    : operation;
}

/** Fold queued updates for one node into a single operation (later fields win). */
export function mergeUpdateOperations(operations: NodeUpdateOperation[]): NodeUpdateOperation[] {
  const merged = new Map<string, NodeUpdateOperation>();
  for (const operation of operations) {
    const previous = merged.get(operation.id);
    merged.set(operation.id, previous
      ? {
        ...previous,
        ...operation,
        data: previous.data || operation.data ? { ...previous.data, ...operation.data } : undefined,
      }
      : operation);
  }
  return [...merged.values()].map(operation => {
    if (operation.data === undefined) delete operation.data;
    return operation;
  });
}

/** Apply a body patch to the local node copy the view renders. */
export function applyLocalPatch(node: CanvasNode, patch: Partial<CanvasNode>): CanvasNode {
  return {
    ...node,
    ...(typeof patch.width === 'number' ? { width: patch.width } : {}),
    ...(typeof patch.height === 'number' ? { height: patch.height } : {}),
    ...(patch.data ? { data: { ...node.data, ...patch.data } as CanvasNode['data'] } : {}),
  };
}
