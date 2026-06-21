import type { CanvasNode, FileNodeData } from '../types';

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
