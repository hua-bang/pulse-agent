/**
 * Workspace meta reader — lets the agent learn the workspace's rootFolder
 * (from the renderer-owned manifest) and load its pulse-workspace.md if
 * present.
 *
 * pulse-workspace.md is the workspace's shared "brain" — humans and the
 * Canvas Agent both edit it. Its content is appended to the system prompt
 * every turn so the agent always sees the latest goal/status the human
 * wrote. We use a Pulse-specific filename (rather than the community
 * AGENTS.md convention) so that other coding agents opening the same
 * folder don't pick it up as instructions to themselves.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');
const MANIFEST_PATH = join(STORE_DIR, '__workspaces__.json');

export const WORKSPACE_DOC_FILENAME = 'pulse-workspace.md';

interface ManifestWorkspace {
  id: string;
  name?: string;
  rootFolder?: string;
}

interface Manifest {
  workspaces?: ManifestWorkspace[];
}

export interface WorkspaceMeta {
  rootFolder?: string;
  name?: string;
}

export async function readWorkspaceMeta(workspaceId: string): Promise<WorkspaceMeta> {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(raw) as Manifest;
    const entry = manifest.workspaces?.find((w) => w.id === workspaceId);
    if (!entry) return {};
    return { rootFolder: entry.rootFolder, name: entry.name };
  } catch {
    return {};
  }
}

export async function readWorkspaceDoc(rootFolder: string | undefined): Promise<string | null> {
  if (!rootFolder) return null;
  try {
    const content = await fs.readFile(join(rootFolder, WORKSPACE_DOC_FILENAME), 'utf-8');
    const trimmed = content.trim();
    return trimmed.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/**
 * Workspace environment + `pulse-workspace.md` section of the system prompt.
 * Lives beside the meta/doc readers it formats (moved out of canvas-agent.ts,
 * which is at its file-size baseline).
 */
export function formatWorkspaceContextSection(rootFolder: string | undefined, workspaceDoc: string | null): string {
  if (!rootFolder && !workspaceDoc) return '';

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

  if (workspaceDoc) {
    const docPath = rootFolder ? `${rootFolder}/${WORKSPACE_DOC_FILENAME}` : WORKSPACE_DOC_FILENAME;
    parts.push(
      `## Workspace Context (${docPath})`,
      'The following document is authored jointly by the user and you. ' +
        'It captures the goal, current status, and any decisions for this workspace. ' +
        'Treat it as authoritative context — refer back to it when planning your next steps. ' +
        'When you make meaningful progress, change direction, or resolve a blocker, ' +
        'use the `edit` tool to update the relevant section so the user sees fresh state next time.',
      '',
      workspaceDoc.trim(),
      '',
    );
  }

  return parts.join('\n');
}
