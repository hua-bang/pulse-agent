import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceNodeRecord } from '../canvas/nodes/store';
import { applyKnowledgeChangeProposal, knowledgeNodeFingerprint } from '../canvas/nodes/knowledge-change';

const record = (): WorkspaceNodeRecord => ({
  schemaVersion: 1,
  id: 'node-1',
  type: 'text',
  title: 'Old title',
  data: { content: 'Old content', untouched: true },
  properties: { tags: ['old-tag'], owner: 'Jasper' },
  updatedAt: 100,
  createdAt: 10,
});

describe('applyKnowledgeChangeProposal', () => {
  it('atomically applies the reviewed title, content, and tags to the current node', async () => {
    const writeNode = vi.fn();
    const result = await applyKnowledgeChangeProposal({
      kind: 'knowledge-change-proposal',
      version: 1,
      proposalId: 'proposal-1',
      target: {
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        nodeType: 'text',
        nodeTitle: 'Old title',
        expectedUpdatedAt: 100,
        expectedFingerprint: knowledgeNodeFingerprint(record()),
      },
      summary: 'Make the note clearer.',
      before: {
        title: 'Old title',
        content: 'Old content',
        tags: ['old-tag'],
      },
      patch: {
        title: 'Clear title',
        content: 'Clear content',
        tags: ['clear-tag'],
      },
    }, {
      readNode: async () => record(),
      writeNode,
      resolveTags: async () => ['clear-tag-id'],
      now: () => 200,
    });

    expect(result.ok).toBe(true);
    expect(writeNode).toHaveBeenCalledWith('workspace-1', expect.objectContaining({
      title: 'Clear title',
      data: { content: 'Clear content', untouched: true },
      properties: { tags: ['clear-tag-id'], owner: 'Jasper' },
      updatedAt: 200,
    }));
  });

  it('rejects a stale proposal without writing over a newer edit', async () => {
    const writeNode = vi.fn();
    const result = await applyKnowledgeChangeProposal({
      kind: 'knowledge-change-proposal',
      version: 1,
      proposalId: 'proposal-stale',
      target: {
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        nodeType: 'text',
        nodeTitle: 'Old title',
        expectedUpdatedAt: 99,
        expectedFingerprint: knowledgeNodeFingerprint(record()),
      },
      summary: 'Stale rewrite.',
      before: { title: 'Old title' },
      patch: { title: 'Overwrite' },
    }, {
      readNode: async () => record(),
      writeNode,
      resolveTags: async (tags) => tags,
      now: () => 200,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: 'conflict',
      currentUpdatedAt: 100,
    }));
    expect(writeNode).not.toHaveBeenCalled();
  });

  it('marks file content dirty and rejects content replacement for non-textual nodes', async () => {
    const file: WorkspaceNodeRecord = {
      ...record(),
      type: 'file',
      data: { filePath: '/tmp/note.md', content: 'Old content', saved: true, modified: false },
    };
    const writeNode = vi.fn();
    const baseProposal = {
      kind: 'knowledge-change-proposal' as const,
      version: 1 as const,
      proposalId: 'proposal-file',
      target: {
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        nodeType: 'file',
        nodeTitle: 'Old title',
        expectedUpdatedAt: 100,
        expectedFingerprint: knowledgeNodeFingerprint(file),
      },
      summary: 'Rewrite the body.',
      before: { content: 'Old content' },
      patch: { content: 'New content' },
    };

    expect(await applyKnowledgeChangeProposal(baseProposal, {
      readNode: async () => file,
      writeNode,
      resolveTags: async (tags) => tags,
      now: () => 200,
    })).toEqual(expect.objectContaining({ ok: true }));
    expect(writeNode).toHaveBeenCalledWith('workspace-1', expect.objectContaining({
      data: expect.objectContaining({ content: 'New content', saved: false, modified: true }),
    }));

    writeNode.mockClear();
    const image = { ...file, type: 'image' };
    const rejected = await applyKnowledgeChangeProposal({
      ...baseProposal,
      target: {
        ...baseProposal.target,
        nodeType: 'image',
        expectedFingerprint: knowledgeNodeFingerprint(image),
      },
    }, {
      readNode: async () => image,
      writeNode,
      resolveTags: async (tags) => tags,
      now: () => 200,
    });
    expect(rejected).toEqual(expect.objectContaining({ ok: false, code: 'invalid' }));
    expect(writeNode).not.toHaveBeenCalled();
  });
});
