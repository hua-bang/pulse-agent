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
