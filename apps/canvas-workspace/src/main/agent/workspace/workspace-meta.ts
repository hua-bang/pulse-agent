/**
 * Workspace meta reader — lets the agent learn the workspace's rootFolder
 * (from the renderer-owned manifest), and formats the workspace environment
 * and context-document section of the system prompt. The context document
 * itself lives in storage (see ./workspace-context).
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { WorkspaceContextDoc } from './workspace-context';

const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');
const MANIFEST_PATH = join(STORE_DIR, '__workspaces__.json');

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

/**
 * Workspace environment + workspace context section of the system prompt.
 * Lives beside the meta reader it formats (moved out of canvas-agent.ts,
 * which is at its file-size baseline).
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
