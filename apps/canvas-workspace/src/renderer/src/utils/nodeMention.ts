import type { AgentContextTabRef, CanvasNode, FileNodeData } from '../types';

/**
 * Canonical `@[label](canvas:id)` mention string for a canvas node.
 *
 * Shared by every surface that lets the user "@" a node — the Terminal, the
 * running Agent terminal, and the plain-textarea inputs (Coding Agent setup
 * prompt, Agent Teams Team Lead brief) — so the wire format stays identical.
 */
export function buildNodeMention(node: CanvasNode): string {
  const filePath = node.type === 'file' ? (node.data as FileNodeData).filePath : undefined;
  const label = filePath ? filePath.split('/').pop() : node.title;
  return `@[${label}](canvas:${node.id})`;
}

/**
 * Plain-text mention for a dock tab, for terminals that cannot carry chat
 * mention chips. A web page points at its URL and a node-detail tab uses the
 * node format above. Other tabs point at the dock tab id, which
 * `pulse-canvas runtime call browser.tabs.list` resolves.
 */
export function buildTabMention(tab: AgentContextTabRef): string {
  if (tab.kind === 'link' && tab.url) return `@[${tab.title}](${tab.url})`;
  if (tab.kind === 'node-detail' && tab.nodeId) return `@[${tab.title}](canvas:${tab.nodeId})`;
  return `@[${tab.title}](tab:${tab.id})`;
}

function padMention(mention: string, context?: { before?: string; after?: string }): string {
  const needsLeading = context ? Boolean(context.before && !/\s$/.test(context.before)) : true;
  const needsTrailing = context ? !context.after || !/^\s/.test(context.after) : true;
  const leading = needsLeading ? ' ' : '';
  const trailing = needsTrailing ? ' ' : '';
  return `${leading}${mention}${trailing}`;
}

export function buildNodeMentionInsertion(
  node: CanvasNode,
  context?: { before?: string; after?: string },
): string {
  return padMention(buildNodeMention(node), context);
}

export function buildTabMentionInsertion(tab: AgentContextTabRef): string {
  return padMention(buildTabMention(tab));
}
