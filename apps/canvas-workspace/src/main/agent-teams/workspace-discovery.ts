import { promises as fs } from 'fs';
import { join } from 'path';
import { STORE_DIR } from '../canvas/storage';

interface AgentTeamWorkspaceDiscoveryOptions {
  storeDir?: string;
  cacheTtlMs?: number;
  now?: () => number;
}

export class AgentTeamWorkspaceDiscovery {
  private cache: { at: number; ids: string[] } | null = null;
  private readonly storeDir: string;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;

  constructor(options: AgentTeamWorkspaceDiscoveryOptions = {}) {
    this.storeDir = options.storeDir ?? STORE_DIR;
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  async discover(activeWorkspaceIds: Iterable<string>): Promise<string[]> {
    const ids = new Set(activeWorkspaceIds);
    if (!this.cache || this.now() - this.cache.at > this.cacheTtlMs) {
      const persistedIds = await this.scanPersistedWorkspaceIds();
      this.cache = { at: this.now(), ids: persistedIds };
    }
    for (const id of this.cache.ids) ids.add(id);
    return [...ids];
  }

  private async scanPersistedWorkspaceIds(): Promise<string[]> {
    const found: string[] = [];
    try {
      const dirents = await fs.readdir(this.storeDir, { withFileTypes: true });
      await Promise.all(dirents.map(async (dirent) => {
        if (!dirent.isDirectory()) return;
        try {
          const stat = await fs.stat(join(this.storeDir, dirent.name, 'agent-teams', 'state.json'));
          if (stat.isFile()) found.push(dirent.name);
        } catch {
          // No team state in this workspace.
        }
      }));
    } catch {
      // Store directory may not exist yet.
    }
    return found;
  }
}
