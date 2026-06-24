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

export const dispatchOpenNode = (detail: OpenNodeDetail): void => {
  window.dispatchEvent(new CustomEvent<OpenNodeDetail>(OPEN_NODE_EVENT, { detail }));
};

/** Build the href stored on a mention link for the given node id. */
export const nodeLinkHref = (nodeId: string): string => `${NODE_LINK_PREFIX}${nodeId}`;

/** Extract a node id from a mention href, or null when it isn't one. */
export const nodeIdFromHref = (href: string | null | undefined): string | null => {
  if (!href || !href.startsWith(NODE_LINK_PREFIX)) return null;
  const id = href.slice(NODE_LINK_PREFIX.length).trim();
  return id.length > 0 ? id : null;
};
