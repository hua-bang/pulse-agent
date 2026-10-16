import type { CanvasNode, IframeNodeData } from '../types';

/**
 * The page a Web node points at, or null when it has none to open.
 *
 * A Web node in URL mode is a bookmark: every "open" surface (canvas header,
 * note mentions, Nodes list, graph) shows it as an ordinary dock web tab
 * rather than a node detail that re-wraps the same browser in extra chrome.
 * HTML-mode nodes have no address, so they keep the node detail.
 */
export const getWebNodeUrl = (node: Pick<CanvasNode, 'type' | 'data'> | undefined): string | null => {
  if (node?.type !== 'iframe') return null;
  const data = node.data as Partial<IframeNodeData> | undefined;
  if (data?.mode && data.mode !== 'url') return null;
  const url = typeof data?.url === 'string' ? data.url.trim() : '';
  return url || null;
};
