/**
 * Transient review contract for AI-assisted node edits.
 *
 * This is deliberately separate from the persisted workspace-node schema:
 * proposals live in chat history and are only converted into an ordinary v1
 * node update after the user confirms them.
 */
export interface KnowledgeChangeProposal {
  kind: 'knowledge-change-proposal';
  version: 1;
  proposalId: string;
  target: {
    workspaceId: string;
    nodeId: string;
    nodeType: string;
    nodeTitle: string;
    workspaceName?: string;
    expectedUpdatedAt?: number;
    expectedFingerprint: string;
  };
  summary: string;
  before: {
    title?: string;
    content?: string;
    tags?: string[];
    aiSummary?: string;
  };
  patch: {
    title?: string;
    content?: string;
    tags?: string[];
    /** A confirmed AI-generated reading aid, kept separate from source content. */
    aiSummary?: string;
  };
}

export const KNOWLEDGE_CHANGE_LIMITS = {
  proposalId: 128,
  workspaceId: 256,
  workspaceName: 200,
  nodeId: 128,
  nodeType: 80,
  nodeTitle: 1_000,
  summary: 500,
  aiSummary: 800,
  title: 500,
  content: 200_000,
  patchTags: 30,
  beforeTags: 200,
  tag: 80,
} as const;

export type KnowledgeChangeApplyResult =
  | {
      ok: true;
      workspaceId: string;
      nodeId: string;
      updatedAt: number;
    }
  | {
      ok: false;
      code: 'invalid' | 'not-found' | 'conflict' | 'write-failed';
      error: string;
      currentUpdatedAt?: number;
    };

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isBoundedString = (value: unknown, max: number, allowEmpty = true): value is string =>
  typeof value === 'string'
  && value.length <= max
  && (allowEmpty || value.trim().length > 0);

const isBoundedStringArray = (value: unknown, maxItems: number, maxLength: number): value is string[] =>
  isStringArray(value)
  && value.length <= maxItems
  && value.every((item) => isBoundedString(item, maxLength, false));

export function isKnowledgeChangeProposal(value: unknown): value is KnowledgeChangeProposal {
  if (!value || typeof value !== 'object') return false;
  const proposal = value as Partial<KnowledgeChangeProposal>;
  const target = proposal.target as Partial<KnowledgeChangeProposal['target']> | undefined;
  const patch = proposal.patch as Partial<KnowledgeChangeProposal['patch']> | undefined;
  if (
    proposal.kind !== 'knowledge-change-proposal'
    || proposal.version !== 1
    || !isBoundedString(proposal.proposalId, KNOWLEDGE_CHANGE_LIMITS.proposalId, false)
    || !isBoundedString(proposal.summary, KNOWLEDGE_CHANGE_LIMITS.summary, false)
    || !target
    || !isBoundedString(target.workspaceId, KNOWLEDGE_CHANGE_LIMITS.workspaceId, false)
    || !isBoundedString(target.nodeId, KNOWLEDGE_CHANGE_LIMITS.nodeId, false)
    || !isBoundedString(target.nodeType, KNOWLEDGE_CHANGE_LIMITS.nodeType, false)
    || !isBoundedString(target.nodeTitle, KNOWLEDGE_CHANGE_LIMITS.nodeTitle)
    || (target.workspaceName !== undefined && !isBoundedString(target.workspaceName, KNOWLEDGE_CHANGE_LIMITS.workspaceName, false))
    || (target.expectedUpdatedAt !== undefined && (
      typeof target.expectedUpdatedAt !== 'number' || !Number.isFinite(target.expectedUpdatedAt)
    ))
    || typeof target.expectedFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(target.expectedFingerprint)
    || !proposal.before
    || typeof proposal.before !== 'object'
    || !patch
    || typeof patch !== 'object'
  ) {
    return false;
  }

  const fields = [patch.title, patch.content, patch.tags, patch.aiSummary];
  if (fields.every((field) => field === undefined)) return false;
  if (patch.title !== undefined && !isBoundedString(patch.title, KNOWLEDGE_CHANGE_LIMITS.title, false)) return false;
  if (patch.content !== undefined && !isBoundedString(patch.content, KNOWLEDGE_CHANGE_LIMITS.content)) return false;
  if (patch.tags !== undefined && !isBoundedStringArray(patch.tags, KNOWLEDGE_CHANGE_LIMITS.patchTags, KNOWLEDGE_CHANGE_LIMITS.tag)) return false;
  if (patch.aiSummary !== undefined && !isBoundedString(patch.aiSummary, KNOWLEDGE_CHANGE_LIMITS.aiSummary, false)) return false;
  if (proposal.before.title !== undefined && !isBoundedString(proposal.before.title, KNOWLEDGE_CHANGE_LIMITS.nodeTitle)) return false;
  if (proposal.before.content !== undefined && !isBoundedString(proposal.before.content, KNOWLEDGE_CHANGE_LIMITS.content)) return false;
  if (proposal.before.tags !== undefined && !isBoundedStringArray(proposal.before.tags, KNOWLEDGE_CHANGE_LIMITS.beforeTags, KNOWLEDGE_CHANGE_LIMITS.tag)) return false;
  if (proposal.before.aiSummary !== undefined && !isBoundedString(proposal.before.aiSummary, KNOWLEDGE_CHANGE_LIMITS.aiSummary, false)) return false;
  return true;
}
