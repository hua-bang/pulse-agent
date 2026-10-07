import type { CanvasNode } from '../../shared/canvas';
import { CANVAS_NODE_DEFAULTS } from '../../shared/canvas-node-defaults';
import { createPassiveNodeData } from './tools/_shared/passive-node-data';

/** Only passive node bodies can be mounted before the user approves execution. */
export const createApprovalNodePreview = (
  name: string,
  input: unknown,
  toolCallId: string,
): CanvasNode | undefined => {
  const normalized = name.trim().toLowerCase();
  if (
    normalized !== 'canvas_create_node'
    && !normalized.endsWith('_canvas_create_node')
  ) return undefined;
  if (!input || typeof input !== 'object') return undefined;
  const proposed = input as Record<string, unknown>;
  const type = proposed.type;
  if (type !== 'mindmap' && type !== 'text' && type !== 'image' && type !== 'shape') return undefined;
  const extra = proposed.data && typeof proposed.data === 'object'
    ? proposed.data as Record<string, unknown>
    : {};
  const defaults = CANVAS_NODE_DEFAULTS[type];
  const title = typeof proposed.title === 'string' ? proposed.title : defaults.title;
  const content = typeof proposed.content === 'string' ? proposed.content : '';
  return {
    id: `approval-preview:${toolCallId}`,
    type,
    title,
    x: 0,
    y: 0,
    width: typeof proposed.width === 'number' ? proposed.width : defaults.width,
    height: typeof proposed.height === 'number' ? proposed.height : defaults.height,
    data: createPassiveNodeData(type, content, extra, typeof proposed.title === 'string' ? proposed.title : undefined),
  };
};
