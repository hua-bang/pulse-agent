/**
 * Per-workspace cache of the renderer's current canvas selection.
 *
 * The selection lives in renderer state (one Canvas component per
 * workspace). The agent runs in the main process and cannot observe React
 * state directly, so the renderer pushes selection changes to this cache
 * via the `canvas:set-selection` IPC channel and the `canvas_get_selection`
 * tool reads from it synchronously.
 *
 * Push-based instead of request/response because:
 *   - selection changes are user-driven and rare relative to LLM calls;
 *     the renderer can keep main up to date for free
 *   - tools execute in main and would otherwise have to round-trip to the
 *     renderer for every read, adding latency and a failure mode (renderer
 *     gone, no window) that doesn't exist with a cache
 *
 * Stale-data trade-off: if the user changes selection after the agent has
 * already started thinking but before it calls `canvas_get_selection`, the
 * tool returns the newer selection — usually what the user wants.
 */

import { ipcMain } from 'electron';

const selectionByWorkspace = new Map<string, string[]>();

export function getSelection(workspaceId: string): string[] {
  return selectionByWorkspace.get(workspaceId) ?? [];
}

export function setSelection(workspaceId: string, nodeIds: string[]): void {
  if (nodeIds.length === 0) selectionByWorkspace.delete(workspaceId);
  else selectionByWorkspace.set(workspaceId, [...nodeIds]);
}

export function clearSelection(workspaceId: string): void {
  selectionByWorkspace.delete(workspaceId);
}

let installed = false;

export function setupSelectionIpc(): void {
  if (installed) return;
  installed = true;

  ipcMain.on(
    'canvas:set-selection',
    (_event, payload: { workspaceId: string; nodeIds: string[] }) => {
      if (!payload || typeof payload.workspaceId !== 'string') return;
      const ids = Array.isArray(payload.nodeIds) ? payload.nodeIds.filter((id) => typeof id === 'string') : [];
      setSelection(payload.workspaceId, ids);
    },
  );
}
