/**
 * Workspace meta reader — lets the agent learn the workspace's rootFolder
 * from the renderer-owned manifest. Kept tiny: eager tools import it, so it
 * sits in the main bundle (the prompt formatter lives in ./workspace-context).
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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
