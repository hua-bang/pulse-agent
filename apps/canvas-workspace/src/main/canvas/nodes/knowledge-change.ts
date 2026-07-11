import { createHash } from 'crypto';
import type {
  KnowledgeChangeApplyResult,
  KnowledgeChangeProposal,
} from '../../../shared/knowledge-change';
import {
  mutateWorkspaceNode,
  readWorkspaceNode,
  writeWorkspaceNode,
  type WorkspaceNodeRecord,
} from './store';
import { readKnowledgeTags, upsertKnowledgeTag } from './tags';

interface KnowledgeChangeDependencies {
  readNode: (workspaceId: string, nodeId: string) => Promise<WorkspaceNodeRecord | null>;
  writeNode: (workspaceId: string, node: WorkspaceNodeRecord) => Promise<void>;
  resolveTags: (tags: string[]) => Promise<string[]>;
  now: () => number;
}

async function resolveKnowledgeTagIds(rawTags: string[]): Promise<string[]> {
  const definitions = await readKnowledgeTags();
  const byToken = new Map<string, string>();
  for (const tag of definitions) {
    byToken.set(tag.id.toLowerCase(), tag.id);
    byToken.set(tag.name.toLowerCase(), tag.id);
  }

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawTags) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let id = byToken.get(key);
    if (!id) {
      const created = await upsertKnowledgeTag({ name });
      id = created.id;
      byToken.set(key, id);
      byToken.set(id.toLowerCase(), id);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }
  return resolved;
}

const defaultDependencies: KnowledgeChangeDependencies = {
  readNode: readWorkspaceNode,
  writeNode: writeWorkspaceNode,
  resolveTags: resolveKnowledgeTagIds,
  now: Date.now,
};

export function knowledgeNodeFingerprint(record: WorkspaceNodeRecord): string {
  return createHash('sha256').update(JSON.stringify({
    type: record.type,
    title: record.title,
    data: record.data,
    properties: record.properties,
    links: record.links,
    updatedAt: record.updatedAt,
  })).digest('hex');
}

async function prepareKnowledgeChange(
  current: WorkspaceNodeRecord | null,
  proposal: KnowledgeChangeProposal,
  dependencies: Pick<KnowledgeChangeDependencies, 'resolveTags' | 'now'>,
): Promise<{ record?: WorkspaceNodeRecord; result: KnowledgeChangeApplyResult }> {
  const { workspaceId, nodeId, expectedUpdatedAt, expectedFingerprint } = proposal.target;
  if (!current) {
    return { result: { ok: false, code: 'not-found', error: 'Node not found.' } };
  }
  if (
    (current.updatedAt ?? undefined) !== expectedUpdatedAt
    || knowledgeNodeFingerprint(current) !== expectedFingerprint
  ) {
    return {
      result: {
        ok: false,
        code: 'conflict',
        error: 'The node changed after this proposal was created. Review it again before applying.',
        currentUpdatedAt: current.updatedAt,
      },
    };
  }
  if (proposal.patch.content !== undefined && current.type !== 'text' && current.type !== 'file') {
    return {
      result: {
        ok: false,
        code: 'invalid',
        error: `Content replacement is not supported for ${current.type} nodes.`,
      },
    };
  }

  const tags = proposal.patch.tags !== undefined
    ? await dependencies.resolveTags(proposal.patch.tags)
    : undefined;
  const updatedAt = dependencies.now();
  const nextData = proposal.patch.content === undefined
    ? current.data
    : current.type === 'file'
      ? { ...current.data, content: proposal.patch.content, modified: true, saved: false }
      : { ...current.data, content: proposal.patch.content };
  const next: WorkspaceNodeRecord = {
    ...current,
    ...(proposal.patch.title !== undefined ? { title: proposal.patch.title.trim() } : {}),
    data: nextData,
    properties: tags !== undefined
      ? { ...current.properties, tags }
      : current.properties,
    updatedAt,
  };
  return {
    record: next,
    result: { ok: true, workspaceId, nodeId, updatedAt },
  };
}

export async function applyKnowledgeChangeProposal(
  proposal: KnowledgeChangeProposal,
  dependencies?: KnowledgeChangeDependencies,
): Promise<KnowledgeChangeApplyResult> {
  const { workspaceId, nodeId } = proposal.target;
  const hasPatch = proposal.patch.title !== undefined
    || proposal.patch.content !== undefined
    || proposal.patch.tags !== undefined;
  if (!workspaceId || !nodeId || !hasPatch) {
    return { ok: false, code: 'invalid', error: 'This change proposal is incomplete.' };
  }

  try {
    if (dependencies) {
      const prepared = await prepareKnowledgeChange(
        await dependencies.readNode(workspaceId, nodeId),
        proposal,
        dependencies,
      );
      if (prepared.record) await dependencies.writeNode(workspaceId, prepared.record);
      return prepared.result;
    }

    return await mutateWorkspaceNode(workspaceId, nodeId, (current) => (
      prepareKnowledgeChange(current, proposal, defaultDependencies)
    ));
  } catch (error) {
    return {
      ok: false,
      code: 'write-failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
