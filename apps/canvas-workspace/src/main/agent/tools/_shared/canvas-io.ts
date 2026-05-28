import { join } from 'path';
import { homedir } from 'os';
import {
  readCanvasFull,
  writeCanvasFull,
  getCanvasJsonPath,
} from '../../../canvas/storage';
import type { CanvasSaveData } from '../types';

export const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');
export const BLANK_PAGE_URL = 'about:blank';

// ─── Helpers ───────────────────────────────────────────────────────

export function canvasPath(workspaceId: string): string {
  return getCanvasJsonPath(workspaceId);
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
  const { data } = await readCanvasFull(workspaceId);
  if (!data) return null;
  // Mirror the legacy guarantee that `nodes` is always an array; some
  // downstream tool handlers index into it without a length check.
  const out = data as CanvasSaveData;
  out.nodes = out.nodes ?? [];
  return out;
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
  data.savedAt = new Date().toISOString();

  // Empty-write guard: refuse to overwrite a populated canvas with a
  // zero-node payload. Mirrors the same guard in canvas-store.ts /
  // canvas-cli — every writer to canvas.json enforces this contract.
  if (!opts.allowEmpty && Array.isArray(data.nodes) && data.nodes.length === 0) {
    const existing = await readCanvasFull(workspaceId).catch(() => {
      // Can't verify what's on disk — refuse rather than risk wiping a
      // populated canvas that just happened to be unreadable this turn.
      throw new Error(
        `[canvas-agent] failed to read canvas.json while guarding empty write ` +
          `for workspace "${workspaceId}"`,
      );
    });
    const existingNodes = Array.isArray(existing.data?.nodes)
      ? existing.data!.nodes
      : [];
    if (existingNodes.length > 0) {
      throw new Error(
        `[canvas-agent] refusing to overwrite ${existingNodes.length} on-disk nodes ` +
          `with empty nodes for workspace "${workspaceId}". ` +
          `Pass { allowEmpty: true } to saveCanvas if this wipe is intentional.`,
      );
    }
  }

  await writeCanvasFull(workspaceId, data);
}
