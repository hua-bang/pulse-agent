/**
 * Renderer-facing admin IPC for the memory panel (Phase 2 UI).
 *
 * Channels are auto-prefixed `plugin:memory:` by the plugin registry and
 * called from the renderer half via `ctx.invoke(...)`. Read-only listing of
 * memory by scope (a workspace bucket or the global bucket) plus pin / forget
 * mutations — all delegating to the shared FileMemoryPluginService.
 */

import type { MemoryItem } from 'pulse-coder-memory-plugin';
import type { MainCtx } from '../../types';
import { listWorkspaces } from '../../../main/canvas/workspaces';
import { getCanvasMemoryService } from './canvas-memory-service';
import { CANVAS_GLOBAL_MEMORY_KEY, memoryKeysForScope } from './keys';

export interface MemoryItemView {
  id: string;
  type: MemoryItem['type'];
  scope: MemoryItem['scope'];
  sourceType?: MemoryItem['sourceType'];
  summary: string;
  content: string;
  keywords: string[];
  pinned: boolean;
  updatedAt: number;
  dayKey?: string;
  hitCount?: number;
  sessionId?: string;
}

export interface MemoryScopeOption {
  /** 'global' or a workspaceId. */
  id: string;
  label: string;
  kind: 'global' | 'workspace';
}

/** Map a panel scope selection to its memory bucket platformKey. */
export function platformKeyForSelection(selection: string): string {
  if (!selection || selection === 'global') return CANVAS_GLOBAL_MEMORY_KEY;
  return memoryKeysForScope({ kind: 'workspace', workspaceId: selection }).workspaceKey;
}

export function toMemoryView(item: MemoryItem): MemoryItemView {
  return {
    id: item.id,
    type: item.type,
    scope: item.scope,
    sourceType: item.sourceType,
    summary: item.summary,
    content: item.content,
    keywords: item.keywords,
    pinned: item.pinned,
    updatedAt: item.updatedAt,
    dayKey: item.dayKey,
    hitCount: item.hitCount,
    sessionId: item.sessionId,
  };
}

function readMutationArgs(args: unknown[]): { selection: string; id?: string } {
  const payload = (args[0] ?? {}) as { selection?: string; id?: string };
  return { selection: payload.selection ?? 'global', id: payload.id };
}

export function registerMemoryAdminIpc(ctx: MainCtx): void {
  // Scope picker options: the global bucket + every workspace.
  ctx.handle('list-scopes', async () => {
    const { activeId, workspaces } = await listWorkspaces();
    const scopes: MemoryScopeOption[] = [
      { id: 'global', label: '全局记忆', kind: 'global' },
      ...workspaces.map((w) => ({ id: w.id, label: w.name, kind: 'workspace' as const })),
    ];
    return { activeId: activeId ?? null, scopes };
  });

  // Memory items for a scope (daily-log sediment + explicit records; soul and
  // other-session items are excluded by the service's visibility rules).
  ctx.handle('list', async (_event, ...args) => {
    const selection = typeof args[0] === 'string' ? args[0] : 'global';
    try {
      const service = await getCanvasMemoryService();
      const items = await service.list({ platformKey: platformKeyForSelection(selection), limit: 50 });
      return { ok: true, items: items.map(toMemoryView) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), items: [] };
    }
  });

  ctx.handle('pin', async (_event, ...args) => {
    const { selection, id } = readMutationArgs(args);
    if (!id) return { ok: false, error: 'id required' };
    try {
      const service = await getCanvasMemoryService();
      const res = await service.pin(platformKeyForSelection(selection), id);
      return { ok: res.ok, error: res.reason };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ctx.handle('forget', async (_event, ...args) => {
    const { selection, id } = readMutationArgs(args);
    if (!id) return { ok: false, error: 'id required' };
    try {
      const service = await getCanvasMemoryService();
      const res = await service.forget(platformKeyForSelection(selection), id);
      return { ok: res.ok, error: res.reason };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
