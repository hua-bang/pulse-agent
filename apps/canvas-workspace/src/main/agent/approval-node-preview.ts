import type { CanvasNode } from '../../shared/canvas';
import type { ApprovalNodeSummary } from '../../shared/agent-chat';
import { CANVAS_NODE_DEFAULTS } from '../../shared/canvas-node-defaults';
import { createPassiveNodeData } from './tools/_shared/passive-node-data';

const isCreateNodeTool = (name: string): boolean => {
  const normalized = name.trim().toLowerCase();
  return normalized === 'canvas_create_node' || normalized.endsWith('_canvas_create_node');
};

const proposedRecord = (input: unknown): Record<string, unknown> | undefined => {
  if (!input || typeof input !== 'object') return undefined;
  return input as Record<string, unknown>;
};

/** Hostname of an http(s) URL. Paths, queries, and other schemes stay hidden. */
export const approvalUrlHost = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.host || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Title, type, and URL host for a proposed node. Web images and iframes have
 * no local body to mount before approval, so the card reads this instead.
 */
export const describeApprovalNode = (
  name: string,
  input: unknown,
): ApprovalNodeSummary | undefined => {
  if (!isCreateNodeTool(name)) return undefined;
  const proposed = proposedRecord(input);
  if (!proposed) return undefined;
  const type = typeof proposed.type === 'string' ? proposed.type : undefined;
  const defaults = type && Object.prototype.hasOwnProperty.call(CANVAS_NODE_DEFAULTS, type)
    ? CANVAS_NODE_DEFAULTS[type as CanvasNode['type']]
    : undefined;
  const explicitTitle = typeof proposed.title === 'string' ? proposed.title.trim() : '';
  const title = explicitTitle || defaults?.title;
  if (!type && !title) return undefined;
  const extra = proposed.data && typeof proposed.data === 'object'
    ? proposed.data as Record<string, unknown>
    : {};
  const urlHost = approvalUrlHost(extra.url);
  return {
    title: (title || type || 'Node').slice(0, 120),
    type: type || 'node',
    ...(urlHost ? { urlHost } : {}),
  };
};

/** Only passive node bodies can be mounted before the user approves execution. */
export const createApprovalNodePreview = (
  name: string,
  input: unknown,
  toolCallId: string,
): CanvasNode | undefined => {
  if (!isCreateNodeTool(name)) return undefined;
  const proposed = proposedRecord(input);
  if (!proposed) return undefined;
  const type = proposed.type;
  if (type !== 'mindmap' && type !== 'text' && type !== 'image' && type !== 'shape') return undefined;
  const extra = proposed.data && typeof proposed.data === 'object'
    ? proposed.data as Record<string, unknown>
    : {};
  // A web image has no local file until the tool runs, so there is nothing to show yet.
  if (type === 'image' && !extra.filePath && typeof extra.url === 'string') return undefined;
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
