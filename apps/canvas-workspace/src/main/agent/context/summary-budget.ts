import type { EdgeSummary, NodeSummary, WorkspaceSummary } from '../types';

/**
 * Node and edge limits for the canvas summary that rides in every prompt.
 * The summary lists one line per node, so an uncapped large canvas costs
 * tens of thousands of tokens on every turn. Past these limits the prompt
 * keeps a prioritized subset and tells the model to search for the rest.
 */
export const PROMPT_SUMMARY_NODE_LIMIT = 80;
export const PROMPT_SUMMARY_EDGE_LIMIT = 60;

/** Containers describe the board's structure, so they outrank plain cards. */
const STRUCTURE_TYPES = new Set(['frame', 'group']);

/**
 * Trim a summary for the prompt. Priority: focus nodes (the user's
 * selection), then frames and groups, then the most recently added nodes.
 * Kept nodes stay in canvas order. Edges stay only when both node endpoints
 * are kept. The returned summary records what was left out.
 */
export function limitSummaryForPrompt(
  summary: WorkspaceSummary,
  focusNodeIds: Iterable<string> = [],
  nodeLimit = PROMPT_SUMMARY_NODE_LIMIT,
  edgeLimit = PROMPT_SUMMARY_EDGE_LIMIT,
): WorkspaceSummary {
  const edges = summary.edges ?? [];
  if (summary.nodes.length <= nodeLimit && edges.length <= edgeLimit) return summary;

  const kept = new Set<string>();
  const take = (node: NodeSummary) => {
    if (kept.size < nodeLimit) kept.add(node.id);
  };
  const focus = new Set(focusNodeIds);
  summary.nodes.filter((node) => focus.has(node.id)).forEach(take);
  summary.nodes.filter((node) => STRUCTURE_TYPES.has(node.type)).forEach(take);
  [...summary.nodes].reverse().forEach(take);

  const nodes = summary.nodes.filter((node) => kept.has(node.id));
  const keptEdges = edges.filter((edge) => isEdgeKept(edge, kept)).slice(0, edgeLimit);

  return {
    ...summary,
    nodes,
    edges: keptEdges.length > 0 ? keptEdges : undefined,
    omitted: {
      nodes: summary.nodes.length - nodes.length,
      edges: edges.length - keptEdges.length,
    },
  };
}

function isEdgeKept(edge: EdgeSummary, kept: Set<string>): boolean {
  if (edge.sourceNodeId && !kept.has(edge.sourceNodeId)) return false;
  if (edge.targetNodeId && !kept.has(edge.targetNodeId)) return false;
  return true;
}

/** The note that replaces the omitted lines in the formatted summary. */
export function formatOmittedSummaryNote(summary: WorkspaceSummary): string[] {
  const omitted = summary.omitted;
  if (!omitted || (omitted.nodes === 0 && omitted.edges === 0)) return [];
  return [
    `_This list is partial: ${omitted.nodes} more nodes and ${omitted.edges} more connections are not shown. ` +
    'Find them with `canvas_search_nodes` (by text, type, or tag) or `canvas_read_layout` (by area); ' +
    'do not assume a node is missing because it is not listed._',
    '',
  ];
}
