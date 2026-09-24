import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { prepareLegacyCanvasImport } from '@pulse-coder/storage/canvas';
import { activateLocalCanvasStorage, writeJsonAtomic } from '@pulse-coder/storage/local';
import type { LegacyNodeConflict } from './legacy-node-arbitration';
import { STORE_DIR } from './paths';
import { resolveStorageNativeBinding } from './backend';
import { readLegacyCanvasWorkspace, validateLegacyCanvas } from './read-legacy-canvas';

/**
 * The app owns the cutover. Legacy JSON is retained and is never re-imported
 * after activation. Returns the divergent node copies that were not imported.
 */
export async function activateCanvasSqlite(root: string = STORE_DIR): Promise<LegacyNodeConflict[]> {
  let conflicts: LegacyNodeConflict[] = [];
  const store = await activateLocalCanvasStorage({
    root,
    nativeBinding: await resolveStorageNativeBinding(),
    loadLegacyWorkspaces: async () => {
      // The importer reads twice to detect concurrent edits; keep the final read's list.
      const found: LegacyNodeConflict[] = [];
      conflicts = found;
      await fs.mkdir(root, { recursive: true });
      const entries = await fs.readdir(root, { withFileTypes: true });
      const snapshots = [];
      const imported = new Set<string>();
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('__storage_migration__.lock')
          || ['skills', '__locks__', '__storage-backup__', '__storage_migration__.lock'].includes(entry.name)) continue;
        const workspaceId = entry.name;
        const snapshot = await readLegacyCanvasWorkspace(root, workspaceId, found);
        if (!snapshot) continue;
        snapshots.push(snapshot);
        imported.add(workspaceId);
      }
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.startsWith('__') || !entry.name.endsWith('.json')) continue;
        const id = entry.name.slice(0, -5);
        if (imported.has(id)) continue;
        const data = JSON.parse(await fs.readFile(join(root, entry.name), 'utf8'));
        if (data && Array.isArray(data.nodes)) {
          validateLegacyCanvas(data, entry.name);
          snapshots.push(prepareLegacyCanvasImport(id, data));
        }
      }
      return snapshots;
    },
  });
  await store.close();
  if (conflicts.length) {
    // Both copies stay on disk; this record lists them next to the migration backups.
    const backupDirectory = join(root, '__storage-backup__');
    await fs.mkdir(backupDirectory, { recursive: true });
    await writeJsonAtomic(join(backupDirectory, `canvas-conflicts-${randomUUID()}.json`), {
      schemaVersion: 1, createdAt: new Date().toISOString(), conflicts,
    });
  }
  return conflicts;
}

/** Startup entry: migrate, then log and announce divergent node copies without blocking. */
export async function activateCanvasSqliteAtStartup(
  writeLog: (scope: string, message: string, detail?: string) => unknown,
  root: string = STORE_DIR,
): Promise<void> {
  const conflicts = await activateCanvasSqlite(root);
  if (!conflicts.length) return;
  const workspaces = [...new Set(conflicts.map(conflict => conflict.workspaceId))];
  await writeLog('storage', 'Resolved divergent legacy node copies', JSON.stringify(
    conflicts.map(({ workspaceId, nodeId, kept, reason }) => ({ workspaceId, nodeId, kept, reason })),
  ));
  const { dialog } = await import('electron');
  void dialog.showMessageBox({
    type: 'warning',
    title: 'Pulse Canvas',
    message: `${workspaces.length} 个工作区的 ${conflicts.length} 个节点有两份不同内容`,
    detail: '已按较新的版本迁移（与旧版打开工作区时的规则相同），另一份没有删除：原文件保持原样，'
      + `两份内容都记录在 ${join(root, '__storage-backup__')} 下的 canvas-conflicts-*.json 中。\n\n`
      + workspaces.join('\n'),
  }).catch(() => undefined);
}
