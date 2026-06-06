/**
 * Maps a Canvas agent scope to its memory "buckets" (platformKeys).
 *
 * The memory plugin hard-partitions all storage by `platformKey`, so each
 * granularity that must be queried independently gets its own bucket:
 *   - session + workspace share ONE bucket (`canvas:ws:{id}`); the session
 *     slice is recovered by filtering recall results on `sessionId`.
 *   - global is a separate, cross-workspace bucket (`canvas:global`).
 * For the global chat agent the workspace bucket *is* the global bucket.
 */

import type { AgentScope } from '../../../main/agent/types';

/** Shared bucket for cross-workspace ("global") memory. */
export const CANVAS_GLOBAL_MEMORY_KEY = 'canvas:global';

/**
 * Sentinel sessionId used when accessing a bucket at non-session granularity
 * (workspace / global). The memory plugin gates recall on `isSessionEnabled`
 * (default-enabled), so any stable id works; this keeps such access out of the
 * real per-session id space.
 */
export const CANVAS_BUCKET_SESSION_ID = '__bucket__';

export interface CanvasMemoryKeys {
  /** Holds session + workspace granularity memory for this scope. */
  workspaceKey: string;
  /** Holds global (cross-workspace) memory. */
  globalKey: string;
}

export function memoryKeysForScope(scope: AgentScope): CanvasMemoryKeys {
  if (scope.kind === 'workspace') {
    return {
      workspaceKey: `canvas:ws:${scope.workspaceId}`,
      globalKey: CANVAS_GLOBAL_MEMORY_KEY,
    };
  }
  // Global chat agent: the workspace bucket and global bucket coincide.
  return { workspaceKey: CANVAS_GLOBAL_MEMORY_KEY, globalKey: CANVAS_GLOBAL_MEMORY_KEY };
}
