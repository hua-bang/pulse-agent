/**
 * Lightweight window-event bridge for opening a canvas node by id.
 *
 * Note mentions (and any other deep node link) dispatch this instead of having
 * a dock callback threaded down through every shared canvas component. The
 * Workbench listens once and opens the target in a deduplicated node tab.
 */

export const OPEN_NODE_EVENT = 'pulse-canvas:open-node';
export const OPEN_NODE_PAGE_EVENT = 'pulse-canvas:open-node-page';
export const PREVIEW_NODE_ACTION_EVENT = 'pulse-canvas:preview-node-action';

/** Prefix of the href used by node-mention links inside notes. */
export const NODE_LINK_PREFIX = 'pulse-canvas://node/';

export interface OpenNodeDetail {
  /** Workspace that owns the node. Empty string → the active workspace. */
  workspaceId: string;
  nodeId: string;
}

export interface NodeLinkTarget {
  workspaceId?: string;
  nodeId: string;
}

const safeDecode = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

export const dispatchOpenNode = (detail: OpenNodeDetail): void => {
  window.dispatchEvent(new CustomEvent<OpenNodeDetail>(OPEN_NODE_EVENT, { detail }));
};

export const dispatchOpenNodePage = (detail: OpenNodeDetail): void => {
  window.dispatchEvent(new CustomEvent<OpenNodeDetail>(OPEN_NODE_PAGE_EVENT, { detail }));
};

/** Action fired from a read-only canvas preview node's header buttons. The
 *  Workbench listens and routes to the active workspace's chat composer or
 *  reference panel; `node` is the full snapshot so no store read is needed. */
export interface PreviewNodeActionDetail<TNode = unknown> {
  action: 'add-to-chat' | 'pin-reference' | 'add-to-canvas';
  /** Workspace that owns the node (the previewed one, not the active one). */
  workspaceId: string;
  node: TNode;
}

export const dispatchPreviewNodeAction = <TNode>(detail: PreviewNodeActionDetail<TNode>): void => {
  window.dispatchEvent(new CustomEvent<PreviewNodeActionDetail<TNode>>(PREVIEW_NODE_ACTION_EVENT, { detail }));
};

/** Ask the dock canvas preview of `workspaceId` to frame `nodeId`. Works both
 *  ways round the mount race: an already-open preview reacts to the event; a
 *  preview that is still mounting consumes the pending entry after its first
 *  load. Used by reference "peek at source" flows. */
export const PREVIEW_FOCUS_NODE_EVENT = 'pulse-canvas:preview-focus-node';
const pendingPreviewFocus = new Map<string, string>();

export const requestPreviewNodeFocus = (workspaceId: string, nodeId: string): void => {
  pendingPreviewFocus.set(workspaceId, nodeId);
  window.dispatchEvent(new CustomEvent<OpenNodeDetail>(PREVIEW_FOCUS_NODE_EVENT, { detail: { workspaceId, nodeId } }));
};

export const consumePendingPreviewFocus = (workspaceId: string): string | undefined => {
  const nodeId = pendingPreviewFocus.get(workspaceId);
  pendingPreviewFocus.delete(workspaceId);
  return nodeId;
};

/** Build the href stored on a mention link for the given node id. */
export const nodeLinkHref = (nodeId: string, workspaceId?: string): string => {
  const href = `${NODE_LINK_PREFIX}${encodeURIComponent(nodeId)}`;
  if (!workspaceId) return href;
  return `${href}?workspace=${encodeURIComponent(workspaceId)}`;
};

/** Extract the canvas-node target from a mention href. */
export const parseNodeLinkHref = (href: string | null | undefined): NodeLinkTarget | null => {
  if (!href || !href.startsWith(NODE_LINK_PREFIX)) return null;
  const raw = href.slice(NODE_LINK_PREFIX.length).trim();
  if (!raw) return null;

  const queryStart = raw.indexOf('?');
  const rawNodeId = queryStart >= 0 ? raw.slice(0, queryStart) : raw;
  const rawQuery = queryStart >= 0 ? raw.slice(queryStart + 1) : '';
  const nodeId = safeDecode(rawNodeId ?? '')?.trim() ?? '';
  if (!nodeId) return null;

  const params = new URLSearchParams(rawQuery);
  const workspace = params.get('workspace')?.trim();
  return {
    nodeId,
    workspaceId: workspace || undefined,
  };
};

/** Extract a node id from a mention href, or null when it isn't one. */
export const nodeIdFromHref = (href: string | null | undefined): string | null => {
  return parseNodeLinkHref(href)?.nodeId ?? null;
};
