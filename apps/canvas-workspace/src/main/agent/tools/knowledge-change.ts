import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  KNOWLEDGE_CHANGE_LIMITS,
  type KnowledgeChangeProposal,
} from '../../../shared/knowledge-change';
import { listWorkspaces } from '../../canvas/workspaces';
import { knowledgeNodeFingerprint } from '../../canvas/nodes/knowledge-change';
import { readWorkspaceNode } from '../../canvas/nodes/store';
import { readKnowledgeTags } from '../../canvas/nodes/tags';
import type { CanvasTool } from './types';

const proposalSchema = z.object({
  workspaceId: z.string().min(1).describe('Owning workspace id from the selected node context or a knowledge search result.'),
  nodeId: z.string().min(1).describe('Exact target node id. Never infer an id from the title.'),
  summary: z.string().min(1).max(KNOWLEDGE_CHANGE_LIMITS.summary).describe('One short sentence explaining why this edit helps.'),
  title: z.string().min(1).max(KNOWLEDGE_CHANGE_LIMITS.title).optional().describe('Complete replacement title. Omit to keep the title unchanged.'),
  content: z.string().max(KNOWLEDGE_CHANGE_LIMITS.content).optional().describe('Complete replacement body/content for text or file nodes. Omit to keep the body unchanged.'),
  tags: z.array(z.string().min(1).max(KNOWLEDGE_CHANGE_LIMITS.tag)).max(KNOWLEDGE_CHANGE_LIMITS.patchTags).optional().describe('Complete replacement tag set, using human-readable tag names or existing ids. Omit to keep tags unchanged.'),
});

type ProposalInput = z.infer<typeof proposalSchema>;

function recordTags(properties: Record<string, unknown> | undefined): string[] {
  const tags = properties?.tags;
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
}

export function createKnowledgeChangeTools(): Record<string, CanvasTool> {
  return {
    canvas_propose_node_change: {
      name: 'canvas_propose_node_change',
      description:
        'Prepare a review card for changing ONE existing knowledge node. This tool NEVER writes the node. ' +
        'First read the exact node, then pass only the complete replacement fields the user asked you to improve: title, content, and/or tags. Content replacement is supported for text and file nodes; other node types can still change title or tags. ' +
        'The UI shows a before/after preview and only applies it after the user clicks Apply. ' +
        'Do not claim the node changed when this tool returns; say that a proposal is ready for review.',
      inputSchema: proposalSchema,
      execute: async (input: ProposalInput) => {
        const record = await readWorkspaceNode(input.workspaceId, input.nodeId);
        if (!record) {
          return JSON.stringify({ ok: false, error: 'Node not found.' });
        }
        if (input.title === undefined && input.content === undefined && input.tags === undefined) {
          return JSON.stringify({ ok: false, error: 'No changes supplied.' });
        }
        if (!input.summary.trim() || (input.title !== undefined && !input.title.trim())) {
          return JSON.stringify({ ok: false, error: 'Summary and replacement title must not be blank.' });
        }
        if (input.content !== undefined && record.type !== 'text' && record.type !== 'file') {
          return JSON.stringify({
            ok: false,
            error: `Content replacement is not supported for ${record.type} nodes. Propose title or tag changes instead.`,
          });
        }

        const definitions = await readKnowledgeTags();
        const tagNames = new Map<string, string>();
        for (const tag of definitions) {
          tagNames.set(tag.id.toLowerCase(), tag.name);
          tagNames.set(tag.name.toLowerCase(), tag.name);
        }
        const currentTags = recordTags(record.properties as Record<string, unknown> | undefined)
          .map((tag) => (tagNames.get(tag.toLowerCase()) ?? tag).slice(0, KNOWLEDGE_CHANGE_LIMITS.tag));
        const content = typeof record.data?.content === 'string' ? record.data.content : undefined;
        if (input.content !== undefined && (content?.length ?? 0) > KNOWLEDGE_CHANGE_LIMITS.content) {
          return JSON.stringify({ ok: false, error: 'This node is too large for a reviewable content proposal.' });
        }
        const patch: KnowledgeChangeProposal['patch'] = {};
        if (input.title !== undefined) patch.title = input.title.trim();
        if (input.content !== undefined) patch.content = input.content;
        if (input.tags !== undefined) {
          patch.tags = Array.from(new Set(input.tags.map((tag) => tag.trim()).filter(Boolean)));
        }
        const { workspaces } = await listWorkspaces();
        const workspaceName = workspaces.find((workspace) => workspace.id === input.workspaceId)?.name;

        const proposal: KnowledgeChangeProposal = {
          kind: 'knowledge-change-proposal',
          version: 1,
          proposalId: randomUUID(),
          target: {
            workspaceId: input.workspaceId,
            nodeId: input.nodeId,
            nodeType: record.type,
            nodeTitle: (record.title?.trim() || input.nodeId).slice(0, KNOWLEDGE_CHANGE_LIMITS.nodeTitle),
            ...(workspaceName ? { workspaceName } : {}),
            expectedUpdatedAt: record.updatedAt,
            expectedFingerprint: knowledgeNodeFingerprint(record),
          },
          summary: input.summary.trim(),
          before: {
            ...(input.title !== undefined && record.title !== undefined ? { title: record.title } : {}),
            ...(input.content !== undefined && content !== undefined ? { content } : {}),
            ...(input.tags !== undefined ? { tags: currentTags.slice(0, KNOWLEDGE_CHANGE_LIMITS.beforeTags) } : {}),
          },
          patch,
        };
        return JSON.stringify(proposal);
      },
    },
  };
}
