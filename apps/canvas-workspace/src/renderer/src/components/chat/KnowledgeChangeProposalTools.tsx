import type { KnowledgeChangeProposal } from '../../../../shared/knowledge-change';
import { KnowledgeChangeProposalCard } from './KnowledgeChangeProposalCard';

interface Props {
  proposals: KnowledgeChangeProposal[];
}

export const KnowledgeChangeProposalTools = ({ proposals }: Props) => (
  <>
    {proposals.map((proposal) => (
      <KnowledgeChangeProposalCard
        key={`knowledge-change-${proposal.proposalId}`}
        proposal={proposal}
      />
    ))}
  </>
);
