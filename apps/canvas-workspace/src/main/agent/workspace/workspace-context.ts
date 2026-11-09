/**
 * Workspace context document — the shared intent/status "brain" that people
 * (settings drawer) and the Canvas Agent (`workspace_context_update`) edit.
 *
 * It lives in Canvas SQLite storage, not in the workspace root folder, so the
 * agent no longer writes into the user's project to keep it current, and the
 * document trashes and restores with its workspace. Earlier releases kept it
 * at `<rootFolder>/pulse-workspace.md`; the first read imports that file once
 * and never touches it again.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { isStorageError } from '@pulse-coder/storage';
import { getLocalCanvasStorage } from '../../canvas/persistence/backend';
import { STORE_DIR } from '../../canvas/persistence/paths';
import { readWorkspaceMeta } from './workspace-meta';

/** Legacy location, read only for the one-time import. */
export const LEGACY_WORKSPACE_DOC_FILENAME = 'pulse-workspace.md';

export interface WorkspaceContextDoc {
  content: string;
  /** null until the document is first saved. Pass it back to write. */
  revision: number | null;
}

export type WorkspaceContextWriteResult =
  | { ok: true; revision: number }
  | { ok: false; error: string; conflict?: boolean };

async function openStorage(root: string) {
  const storage = await getLocalCanvasStorage(root);
  if (!storage) throw new Error('Canvas storage is unavailable');
  return storage;
}

async function readLegacyFile(rootFolder: string | undefined): Promise<string | null> {
  if (!rootFolder) return null;
  try {
    const content = await fs.readFile(join(rootFolder, LEGACY_WORKSPACE_DOC_FILENAME), 'utf-8');
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

export async function readWorkspaceContext(workspaceId: string, root = STORE_DIR): Promise<WorkspaceContextDoc> {
  const storage = await openStorage(root);
  const current = await storage.workspaceContext.read(workspaceId);
  if (current) return { content: current.content, revision: current.revision };

  const legacy = await readLegacyFile((await readWorkspaceMeta(workspaceId)).rootFolder);
  if (legacy === null) return { content: '', revision: null };
  try {
    const receipt = await storage.workspaceContext.commit({ workspaceId, expectedRevision: null, content: legacy });
    return { content: legacy, revision: receipt.revision };
  } catch (error) {
    // Another reader imported first: its row is the authority now.
    if (isStorageError(error) && error.code === 'revision_conflict') {
      const winner = await storage.workspaceContext.read(workspaceId);
      if (winner) return { content: winner.content, revision: winner.revision };
    }
    // Unregistered or trashed workspace: show nothing rather than a stale file.
    if (isStorageError(error) && error.code === 'not_found') return { content: '', revision: null };
    throw error;
  }
}

export async function writeWorkspaceContext(
  workspaceId: string,
  content: string,
  expectedRevision: number | null,
  root = STORE_DIR,
): Promise<WorkspaceContextWriteResult> {
  try {
    const storage = await openStorage(root);
    const receipt = await storage.workspaceContext.commit({ workspaceId, expectedRevision, content });
    return { ok: true, revision: receipt.revision };
  } catch (error) {
    if (isStorageError(error) && error.code === 'revision_conflict') {
      return { ok: false, conflict: true, error: 'The workspace context changed since it was read. Read it again before saving.' };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Workspace environment + workspace context section of the system prompt.
 * Lives here, not in canvas-agent.ts (at its file-size baseline) or in the
 * eagerly bundled workspace-meta.ts.
 */
export function formatWorkspaceContextSection(rootFolder: string | undefined, workspaceDoc: WorkspaceContextDoc | null): string {
  const docContent = workspaceDoc?.content.trim() ?? '';
  if (!rootFolder && !docContent) return '';

  const parts: string[] = [];

  if (rootFolder) {
    parts.push(
      '\n## Workspace Environment',
      `- Root folder: \`${rootFolder}\``,
      '- When creating agent or terminal nodes, use `canvas_create_agent_node` / `canvas_create_terminal_node`; search for a tool first if it is not already available. Omit the `cwd` argument to use the workspace root automatically. Only pass an explicit `cwd` when the work needs to happen outside the root (e.g. a sibling repo or a specific subdirectory).',
      '- File-system tools (`read`, `write`, `edit`, `grep`, `ls`, `bash`) should resolve relative paths against the workspace root.',
      '',
    );
  }

  if (docContent) {
    parts.push(
      '## Workspace Context',
      'The following document is authored jointly by the user and you. ' +
        'It captures the goal, current status, and any decisions for this workspace. ' +
        'Treat it as authoritative context — refer back to it when planning your next steps. ' +
        'It is stored in Pulse workspace storage, not as a file: never create or edit a ' +
        '`pulse-workspace.md` file in the workspace folder. ' +
        'When you make meaningful progress, change direction, or resolve a blocker, ' +
        'call `workspace_context_update` (search for it first if it is not loaded) with the full updated document and ' +
        `\`expected_revision: ${workspaceDoc?.revision ?? 'null'}\` so the user sees fresh state next time.`,
      '',
      docContent,
      '',
    );
  }

  return parts.join('\n');
}
