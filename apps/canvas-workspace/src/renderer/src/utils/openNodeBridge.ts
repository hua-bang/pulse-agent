/**
 * Lightweight window-event bridge for "open / focus a canvas node by id".
 *
 * Note mentions (and any other deep node link) dispatch this instead of having
 * a focus callback threaded down through every shared canvas component. The
 * Workbench listens once and routes it to its existing `requestNodeFocus`.
 */

export const OPEN_NODE_EVENT = 'pulse-canvas:open-node';

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
