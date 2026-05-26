/**
 * Shared helper for notifying every renderer window that one or more
 * canvas nodes were mutated outside the renderer's normal save path
 * (e.g. by a main-process tool or by an artifact pin). Mirrors the
 * payload shape canvas-store.ts emits on `canvas:external-update`.
 */

import { BrowserWindow } from 'electron';

export function broadcastCanvasUpdate(
  workspaceId: string,
  nodeIds: string[],
  kind: 'create' | 'update' | 'delete' = 'update',
  source: string = 'main',
): void {
  const payload = { workspaceId, nodeIds, kind, source };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('canvas:external-update', payload);
  }
}
