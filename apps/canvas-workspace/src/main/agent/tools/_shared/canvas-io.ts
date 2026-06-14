import {
  STORE_DIR,
  canvasPath as resolveCanvasPath,
  loadCanvas as loadCanvasFromService,
  saveCanvas as saveCanvasWithService,
} from '../../../canvas/service';
import type { CanvasSaveData } from '../types';

export { STORE_DIR };
export const BLANK_PAGE_URL = 'about:blank';

// ─── Helpers ───────────────────────────────────────────────────────

export function canvasPath(workspaceId: string): string {
  return resolveCanvasPath(workspaceId);
}

/**
 * Load `canvas.json` for a workspace.
 *
 * Returns `null` ONLY when the file is genuinely missing. Any other
 * failure (I/O error, JSON parse error from catching another writer
 * mid-flush) is rethrown so callers don't confuse "unreadable right now"
 * with "doesn't exist" and wipe real data by bootstrapping an empty
 * canvas.
 *
 * Thin wrapper over the shared `readCanvasFull` helper — gives us
 * transparent v1/v2 read support and `.bak` recovery for free.
 */
export async function loadCanvas(workspaceId: string): Promise<CanvasSaveData | null> {
  return loadCanvasFromService(workspaceId) as Promise<CanvasSaveData | null>;
}

export interface SaveCanvasOptions {
  /**
   * Allow writing an empty `nodes: []` even when the on-disk canvas
   * currently has nodes. Default false: the write is refused to protect
   * against accidental wipes (buggy caller, partially-loaded snapshot).
   * Opt in for flows that legitimately end up with zero nodes, such as
   * deleting the last remaining node.
   */
  allowEmpty?: boolean;
}

export async function saveCanvas(
  workspaceId: string,
  data: CanvasSaveData,
  opts: SaveCanvasOptions = {},
): Promise<void> {
  await saveCanvasWithService(workspaceId, data, opts);
}
