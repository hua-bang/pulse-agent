import { describe, expect, it } from 'vitest';
import {
  partitionKnowledgeChangeProposalTools,
  parseKnowledgeChangeProposalResult,
  parseTrustedKnowledgeChangeProposalTool,
} from './knowledgeChangeProposal';

describe('knowledge change proposal tools', () => {
  it('recognizes the versioned proposal result and ignores ordinary tool JSON', () => {
    const payload = JSON.stringify({
      kind: 'knowledge-change-proposal',
      version: 1,
      proposalId: 'proposal-1',
      target: {
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        nodeType: 'text',
        nodeTitle: 'A node',
        expectedUpdatedAt: 100,
        expectedFingerprint: 'a'.repeat(64),
      },
      summary: 'Clarify it.',
      before: { title: 'A node' },
      patch: { title: 'A clearer node' },
    });
    const result = parseKnowledgeChangeProposalResult(payload);

    expect(result?.proposalId).toBe('proposal-1');
    expect(parseKnowledgeChangeProposalResult('{"ok":false,"error":"nope"}')).toBeNull();
    expect(parseKnowledgeChangeProposalResult('not json')).toBeNull();
    expect(parseKnowledgeChangeProposalResult(JSON.stringify({
      ...JSON.parse(payload),
      summary: 'x'.repeat(501),
    }))).toBeNull();
    expect(parseTrustedKnowledgeChangeProposalTool({
      name: 'third_party_tool',
      status: 'done',
      result: payload,
    })).toBeNull();
    expect(parseTrustedKnowledgeChangeProposalTool({
      name: 'canvas_propose_node_change',
      status: 'done',
      result: payload,
    })?.proposalId).toBe('proposal-1');
  });

  it('separates trusted proposal tools from ordinary tool calls', () => {
    const proposalResult = JSON.stringify({
      kind: 'knowledge-change-proposal',
      version: 1,
      proposalId: 'proposal-2',
      target: {
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        nodeType: 'text',
        nodeTitle: 'A node',
        expectedFingerprint: 'b'.repeat(64),
      },
      summary: 'Clarify it.',
      before: { title: 'A node' },
      patch: { title: 'A clearer node' },
    });
    const partition = partitionKnowledgeChangeProposalTools([
      { id: 1, name: 'canvas_read_node', status: 'done', result: '{}' },
      { id: 2, name: 'canvas_propose_node_change', status: 'done', result: proposalResult },
      { id: 3, name: 'canvas_propose_node_change', status: 'running' },
    ]);

    expect(partition.ordinaryTools.map((tool) => tool.id)).toEqual([1, 3]);
    expect(partition.proposals.map((proposal) => proposal.proposalId)).toEqual(['proposal-2']);
  });
});
