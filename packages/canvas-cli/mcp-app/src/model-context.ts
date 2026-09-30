import type { CanvasSnapshot } from '../../src/mcp/view-types';

/** Characters of each selected node's body included in model context. */
const EXCERPT_LENGTH = 400;
const MAX_SELECTED = 12;

function excerpt(text: string | undefined): string {
  const oneLine = (text ?? '').replace(/\s+/g, ' ').trim();
  return oneLine.length > EXCERPT_LENGTH ? `${oneLine.slice(0, EXCERPT_LENGTH)}…` : oneLine;
}

/**
 * Text the view hands to the model through `ui/update-model-context`: what the
 * user is looking at and which nodes they selected, so "summarize these" or
 * "link this to that" needs no extra lookup. Ids are included so the model
 * can act with canvas_apply / canvas_read_nodes directly.
 */
export function describeViewForModel(snapshot: CanvasSnapshot, selectedIds: Iterable<string>): string {
  const lines = [
    `The user is viewing Pulse Canvas workspace "${snapshot.workspaceName}" (workspaceId: ${snapshot.workspaceId}, ` +
    `${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges).`,
  ];
  const selected = [...selectedIds]
    .map(id => snapshot.nodes.find(node => node.id === id))
    .filter(node => node !== undefined);
  if (selected.length === 0) {
    lines.push('No nodes are selected.');
    return lines.join('\n');
  }
  lines.push(`Selected nodes (${selected.length}):`);
  for (const node of selected.slice(0, MAX_SELECTED)) {
    const body = excerpt(node.content ?? node.outline ?? node.label ?? node.meta);
    lines.push(`- [${node.type}] "${node.title}" (id: ${node.id})${body ? `: ${body}` : ''}`);
  }
  if (selected.length > MAX_SELECTED) lines.push(`…and ${selected.length - MAX_SELECTED} more.`);
  return lines.join('\n');
}
