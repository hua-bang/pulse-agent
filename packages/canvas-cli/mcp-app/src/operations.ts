import type { ViewOperation } from '../../src/mcp/view-types';

type UpdateOp = Extract<ViewOperation, { action: 'update' }>;
type CreateOp = Extract<ViewOperation, { action: 'create' }>;

/**
 * Fold a queue of view edits into the smallest equivalent `canvas_apply`
 * plan: repeated moves of one node become one update, updates to a node
 * created in the same batch fold into its create, and a node created then
 * deleted before flushing disappears together with its edges.
 */
export function coalesceOperations(queue: ViewOperation[]): ViewOperation[] {
  const out: ViewOperation[] = [];
  const createdNodes = new Set<string>();
  const createdEdges = new Set<string>();

  for (const op of queue) {
    switch (op.action) {
      case 'create':
        createdNodes.add(op.id);
        out.push({ ...op });
        break;
      case 'update': {
        const target = out.find((entry): entry is CreateOp | UpdateOp =>
          (entry.action === 'create' || entry.action === 'update') && entry.id === op.id);
        // `create` applies `content` only to file/text nodes; a frame/group
        // label patch must stay a separate update or it would be dropped.
        const contentLostOnCreate = target?.action === 'create'
          && op.content !== undefined
          && target.type !== 'file'
          && target.type !== 'text';
        if (target && !contentLostOnCreate) {
          const { action: _action, id: _id, ...fields } = op;
          Object.assign(target, fields);
        } else {
          out.push({ ...op });
        }
        break;
      }
      case 'delete': {
        const wasCreated = createdNodes.has(op.id);
        for (let i = out.length - 1; i >= 0; i--) {
          const entry = out[i];
          const touchesNode = (entry.action === 'create' || entry.action === 'update') && entry.id === op.id;
          const touchesEdge = entry.action === 'createEdge' && (entry.from === op.id || entry.to === op.id);
          if (touchesNode || (wasCreated && touchesEdge)) out.splice(i, 1);
        }
        if (!wasCreated) out.push(op);
        createdNodes.delete(op.id);
        break;
      }
      case 'createEdge':
        createdEdges.add(op.id);
        out.push({ ...op });
        break;
      case 'deleteEdge': {
        if (createdEdges.has(op.id)) {
          const index = out.findIndex(entry => entry.action === 'createEdge' && entry.id === op.id);
          if (index >= 0) out.splice(index, 1);
          createdEdges.delete(op.id);
        } else {
          out.push(op);
        }
        break;
      }
    }
  }
  return out;
}

let idCounter = 0;

/** Store-safe (`[A-Za-z0-9_.-]`) id minted by the view for optimistic creates. */
export function newViewId(prefix: 'node' | 'edge'): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}
