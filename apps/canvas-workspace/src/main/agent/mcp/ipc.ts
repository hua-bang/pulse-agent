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
  setCanvasMcpToolEnabled,
  upsertCanvasMcpServer,
  type CanvasMcpServer,
  type CanvasMcpStatus,
} from './config';
import {
  clearCanvasMcpOAuth,
  connectCanvasMcpOAuth,
  getCanvasMcpOAuthStatus,
} from './oauth';

async function reloadAgents(scope: CanvasConfigScope): Promise<void> {
  const service = getCanvasAgentService();
  await service.reloadMcp(scope.level === 'workspace' ? scope.workspaceId : undefined);
}

/** Attach per-server connection statuses from the active agent's engine. */
async function withStatuses(status: CanvasMcpStatus, scope: CanvasConfigScope): Promise<CanvasMcpStatus> {
  const workspaceId = scope.level === 'workspace' ? scope.workspaceId : undefined;
  const statuses = getCanvasAgentService().getMcpStatuses(workspaceId);
  const oauthStatuses: CanvasMcpStatus['oauthStatuses'] = {};
  await Promise.all(
    status.servers.map(async (server) => {
      if (server.auth !== 'oauth') return;
      oauthStatuses[server.name] = await getCanvasMcpOAuthStatus(server.name);
    }),
  );
  return {
    ...status,
    statuses,
    oauthStatuses: Object.keys(oauthStatuses).length > 0 ? oauthStatuses : undefined,
  };
}

function requireOAuthServer(status: CanvasMcpStatus, name: string): CanvasMcpServer {
  const key = String(name ?? '').trim();
  const server = status.servers.find((item) => item.name === key);
  if (!server) throw new Error(`MCP server "${key}" not found`);
  if (server.transport === 'stdio') throw new Error(`MCP server "${key}" does not support OAuth`);
  if (server.auth !== 'oauth') throw new Error(`MCP server "${key}" is not configured for OAuth`);
  if (!server.url?.trim()) throw new Error(`MCP server "${key}" requires a URL`);
  return server;
}

export function setupCanvasMcpIpc(): void {
  ipcMain.handle('canvas-mcp:list', async (_event, payload: { scope?: unknown }) => {
    try {
      const scope = parseScopePayload(payload?.scope);
      return { ok: true, status: await withStatuses(await getCanvasMcpStatus(scope), scope) };
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
        return { ok: true, status: await withStatuses(status, scope) };
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
        return { ok: true, status: await withStatuses(status, scope) };
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
        return { ok: true, ...result, status: await withStatuses(result.status, scope) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-mcp:set-tool-enabled',
    async (_event, payload: { scope?: unknown; name: string; tool: string; enabled: boolean }) => {
      try {
        const scope = parseScopePayload(payload?.scope);
        const status = await setCanvasMcpToolEnabled(scope, payload.name, payload.tool, payload.enabled);
        await reloadAgents(scope);
        return { ok: true, status: await withStatuses(status, scope) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-mcp:oauth-connect',
    async (_event, payload: { scope?: unknown; name: string }) => {
      try {
        const scope = parseScopePayload(payload?.scope);
        const current = await getCanvasMcpStatus(scope);
        const server = requireOAuthServer(current, payload.name);
        await connectCanvasMcpOAuth(server.name, server.url!, server.oauth);
        await reloadAgents(scope);
        return { ok: true, status: await withStatuses(await getCanvasMcpStatus(scope), scope) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-mcp:oauth-disconnect',
    async (_event, payload: { scope?: unknown; name: string }) => {
      try {
        const scope = parseScopePayload(payload?.scope);
        const current = await getCanvasMcpStatus(scope);
        const server = requireOAuthServer(current, payload.name);
        await clearCanvasMcpOAuth(server.name);
        await reloadAgents(scope);
        return { ok: true, status: await withStatuses(await getCanvasMcpStatus(scope), scope) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );
}
