/**
 * IPC for user-managed MCP servers (global + per-workspace scope).
 *
 * Channels:
 *   canvas-mcp:list    { scope }                        → status
 *   canvas-mcp:upsert  { scope, server, originalName? } → status
 *   canvas-mcp:remove  { scope, name }                  → status
 *
 * MCP tools are registered statically at Engine init, so after a write we
 * rebuild the Engine for affected active agents (global edits → all agents,
 * workspace edits → that workspace). The conversation is preserved across the
 * reload; inactive workspaces pick up the change on next activation.
 *
 * Each response carries `status.statuses` — the engine MCP plugin's per-server
 * health snapshot from its last initialize — so the UI can show
 * "✓ N tools" / "⚠ <error>" without re-probing.
 */

import { ipcMain } from 'electron';
import { parseScopePayload, type CanvasConfigScope } from '../config-scope';
import { getCanvasAgentService } from '../ipc';
import {
  getCanvasMcpStatus,
  importCanvasMcpJson,
  removeCanvasMcpServer,
  upsertCanvasMcpServer,
  type CanvasMcpServer,
  type CanvasMcpStatus,
} from './config';

async function reloadAgents(scope: CanvasConfigScope): Promise<void> {
  const service = getCanvasAgentService();
  await service.reloadMcp(scope.level === 'workspace' ? scope.workspaceId : undefined);
}

/** Attach per-server connection statuses from the active agent's engine. */
function withStatuses(status: CanvasMcpStatus, scope: CanvasConfigScope): CanvasMcpStatus {
  const workspaceId = scope.level === 'workspace' ? scope.workspaceId : undefined;
  const statuses = getCanvasAgentService().getMcpStatuses(workspaceId);
  return { ...status, statuses };
}

export function setupCanvasMcpIpc(): void {
  ipcMain.handle('canvas-mcp:list', async (_event, payload: { scope?: unknown }) => {
    try {
      const scope = parseScopePayload(payload?.scope);
      return { ok: true, status: withStatuses(await getCanvasMcpStatus(scope), scope) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(
    'canvas-mcp:upsert',
    async (_event, payload: { scope?: unknown; server: CanvasMcpServer; originalName?: string }) => {
      try {
        const scope = parseScopePayload(payload?.scope);
        const status = await upsertCanvasMcpServer(scope, payload.server, payload.originalName);
        await reloadAgents(scope);
        return { ok: true, status: withStatuses(status, scope) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-mcp:remove',
    async (_event, payload: { scope?: unknown; name: string }) => {
      try {
        const scope = parseScopePayload(payload?.scope);
        const status = await removeCanvasMcpServer(scope, payload.name);
        await reloadAgents(scope);
        return { ok: true, status: withStatuses(status, scope) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-mcp:import-json',
    async (_event, payload: { scope?: unknown; json: string }) => {
      try {
        const scope = parseScopePayload(payload?.scope);
        const result = await importCanvasMcpJson(scope, payload.json);
        await reloadAgents(scope);
        return { ok: true, ...result, status: withStatuses(result.status, scope) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );
}
