import { describe, expect, it } from 'vitest';

import type { NodeSummary, WorkspaceSummary } from '../types';
import { formatSummaryForPrompt } from './context-builder';
import { limitSummaryForPrompt } from './summary-budget';

function makeSummary(nodes: NodeSummary[], edgeCount = 0): WorkspaceSummary {
  return {
    workspaceId: 'ws-1',
    workspaceName: 'Big board',
    canvasDir: '/tmp/ws-1',
    nodeCount: nodes.length,
    nodes,
    edges: edgeCount > 0
      ? Array.from({ length: edgeCount }, (_, index) => ({
          id: `edge-${index}`,
          source: nodes[index].title,
          target: nodes[index + 1].title,
          sourceNodeId: nodes[index].id,
          targetNodeId: nodes[index + 1].id,
        }))
      : undefined,
  };
}

function fileNodes(count: number): NodeSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `file-${index}`,
    type: 'file',
    title: `Card ${index}`,
  }));
}

describe('limitSummaryForPrompt', () => {
  it('returns a small summary unchanged', () => {
    const summary = makeSummary(fileNodes(5), 2);

    expect(limitSummaryForPrompt(summary)).toBe(summary);
  });

  it('keeps focus nodes, then containers, then the newest nodes, in canvas order', () => {
    const nodes: NodeSummary[] = [
      { id: 'frame-a', type: 'frame', title: 'Frame A' },
      ...fileNodes(10),
    ];
    const limited = limitSummaryForPrompt(makeSummary(nodes), ['file-0'], 4);

    expect(limited.nodes.map((node) => node.id)).toEqual(['frame-a', 'file-0', 'file-8', 'file-9']);
    expect(limited.nodeCount).toBe(11);
    expect(limited.omitted).toEqual({ nodes: 7, edges: 0 });
  });

  it('drops edges whose endpoints were trimmed and caps the rest', () => {
    const limited = limitSummaryForPrompt(makeSummary(fileNodes(10), 9), [], 5, 2);

    expect(limited.edges?.map((edge) => edge.id)).toEqual(['edge-5', 'edge-6']);
    expect(limited.omitted).toEqual({ nodes: 5, edges: 7 });
  });

  it('bounds the formatted prompt for a large canvas and points to search', () => {
    const summary = makeSummary(fileNodes(500), 400);
    const full = formatSummaryForPrompt(summary);
    const limited = formatSummaryForPrompt(limitSummaryForPrompt(summary));

    expect(limited.length).toBeLessThan(full.length / 4);
    expect(limited).toContain('Total nodes: 500');
    expect(limited).toContain('420 more nodes');
    expect(limited).toContain('canvas_search_nodes');
  });
});
