import {
  isKnowledgeChangeProposal,
  type KnowledgeChangeProposal,
} from '../../../../shared/knowledge-change';
import type { ToolCallStatus } from './types';

interface KnowledgeChangeProposalToolPartition {
  ordinaryTools: ToolCallStatus[];
  proposals: KnowledgeChangeProposal[];
}

export function parseKnowledgeChangeProposalResult(
  result: string | undefined,
): KnowledgeChangeProposal | null {
  if (!result) return null;
  try {
    const parsed: unknown = JSON.parse(result);
    return isKnowledgeChangeProposal(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseTrustedKnowledgeChangeProposalTool(tool: {
  name: string;
  status: 'running' | 'done';
  result?: string;
}): KnowledgeChangeProposal | null {
  if (tool.name !== 'canvas_propose_node_change' || tool.status !== 'done') return null;
  return parseKnowledgeChangeProposalResult(tool.result);
}

export function partitionKnowledgeChangeProposalTools(
  tools: ToolCallStatus[],
): KnowledgeChangeProposalToolPartition {
  const ordinaryTools: ToolCallStatus[] = [];
  const proposals: KnowledgeChangeProposal[] = [];
  for (const tool of tools) {
    const proposal = parseTrustedKnowledgeChangeProposalTool(tool);
    if (proposal) proposals.push(proposal);
    else ordinaryTools.push(tool);
  }
  return { ordinaryTools, proposals };
}
