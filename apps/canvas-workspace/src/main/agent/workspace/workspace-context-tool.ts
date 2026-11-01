/**
 * Workspace context tool — the Canvas Agent's only write path to the shared
 * workspace context document (goal / status / decisions). The document is in
 * Canvas storage, so updates never touch the user's project folder. Reads are
 * injected into the system prompt each turn with the revision to pass back.
 */

import { z } from 'zod';
import type { CanvasTool } from '../tools/types';

export function createWorkspaceContextTools(workspaceId: string): Record<string, CanvasTool> {
  const workspace_context_update: CanvasTool = {
    name: 'workspace_context_update',
    defer_loading: true,
    description:
      'Replace this workspace\'s shared context document (goal, status, decisions) that the user also edits in workspace settings. ' +
      'Send the FULL updated Markdown, not a diff. Pass expected_revision from the Workspace Context section of the system prompt ' +
      '(null when no document exists yet). On a conflict, merge with the returned current content and retry with its revision.',
    inputSchema: z.object({
      content: z.string().describe('The complete updated document in Markdown.'),
      expected_revision: z.number().int().positive().nullable()
        .describe('Revision the update is based on; null to create the first version.'),
    }),
    execute: async (input: { content: string; expected_revision: number | null }) => {
      // Lazy chunk: the tool list is built eagerly, storage access is not needed until a call.
      const { readWorkspaceContext, writeWorkspaceContext } = await import('./workspace-context');
      const result = await writeWorkspaceContext(workspaceId, input.content, input.expected_revision);
      if (result.ok) return JSON.stringify({ ok: true, revision: result.revision });
      if (!result.conflict) return JSON.stringify({ ok: false, error: result.error });
      const current = await readWorkspaceContext(workspaceId).catch(() => null);
      return JSON.stringify({
        ok: false,
        conflict: true,
        error: 'The document changed since your revision (likely edited by the user). Merge and retry.',
        ...(current ? { currentRevision: current.revision, currentContent: current.content } : {}),
      });
    },
  };
  return { workspace_context_update };
}
