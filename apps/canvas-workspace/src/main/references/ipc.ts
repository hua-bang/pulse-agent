/**
 * IPC handlers for the Library drawer's pinned reference entries.
 *
 * Channels:
 *   reference:list  (workspaceId)              → ReferenceEntry[]
 *   reference:save  (workspaceId, references)  → boolean
 */

import { ipcMain } from 'electron';
import type { ReferenceEntry } from '../../shared/references';

export function setupReferenceIpc(): void {
  ipcMain.handle('reference:list', async (_event, payload: { workspaceId: string }) => {
    try {
      const { listReferences } = await import('./store');
      const references = await listReferences(payload.workspaceId);
      return { ok: true, references };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('reference:save', async (_event, payload: {
    workspaceId: string;
    references: ReferenceEntry[];
  }) => {
    try {
      const { saveReferences } = await import('./store');
      await saveReferences(payload.workspaceId, payload.references ?? []);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
