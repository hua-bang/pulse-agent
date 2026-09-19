import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { prepareLegacyCanvasImport } from '@pulse-coder/storage/canvas';
import { activateLocalCanvasStorage } from '@pulse-coder/storage/local';
import { STORE_DIR } from './paths';
import { resolveStorageNativeBinding } from './backend';
import { readLegacyCanvasWorkspace, validateLegacyCanvas } from './read-legacy-canvas';

/** The app owns the cutover. Legacy JSON is retained and is never re-imported after activation. */
export async function activateCanvasSqlite(root: string = STORE_DIR): Promise<void> {
  const store = await activateLocalCanvasStorage({
    root,
    nativeBinding: await resolveStorageNativeBinding(),
    loadLegacyWorkspaces: async () => {
      await fs.mkdir(root, { recursive: true });
      const entries = await fs.readdir(root, { withFileTypes: true });
      const snapshots = [];
      const imported = new Set<string>();
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('__storage_migration__.lock')
          || ['skills', '__locks__', '__storage-backup__', '__storage_migration__.lock'].includes(entry.name)) continue;
        const workspaceId = entry.name;
        const snapshot = await readLegacyCanvasWorkspace(root, workspaceId);
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
}
