import { ipcMain } from 'electron';
import type { AgentScopeRef } from '../types';
import type { CanvasAgentService } from '../service';
import type { McpAppEntrypointKind } from '../../../shared/mcp-apps';
import { listMcpAppEntrypoints, listMcpAppEntrypointsOfKind } from './mcp-app-entrypoints';
import { setupMcpAppNodeContextIpc } from './mcp-app-node-context-ipc';
import { boundedRequest, errorResult, executeWithTimeout, managerFor, resolveAgentScope, validMcpName } from './mcp-app-request';

export { resolveAgentScope } from './mcp-app-request';

function setupMcpAppEntrypointIpc(service: CanvasAgentService): void {
  ipcMain.handle('canvas-agent:mcp-app-list-entrypoints', async (
    event,
    payload: AgentScopeRef & { kind?: McpAppEntrypointKind },
  ) => {
    try {
      return await boundedRequest(event, async () => {
        const { manager } = await managerFor(service, resolveAgentScope(payload ?? {}));
        const apps = manager.listToolApps();
        const kind = payload?.kind;
        const listings = kind === 'node' || kind === 'global' || kind === 'thread'
          ? listMcpAppEntrypointsOfKind(apps, kind)
          : listMcpAppEntrypoints(apps);
        // Icon fetching loads on first use to keep it out of the main startup entry.
        const { withMcpAppIcons } = await import('./mcp-app-icons');
        return { ok: true, value: await withMcpAppIcons(listings, apps) };
      });
    } catch (error) {
      return errorResult(error);
    }
  });

  // Opening a declared entrypoint is a user action in host UI, not an
  // app-initiated call, so it runs without the in-app approval prompt. Only
  // tools that declare a supported entrypoint are callable, and only with `{}`.
  ipcMain.handle(
    'canvas-agent:mcp-app-open-entrypoint',
    async (event, payload: AgentScopeRef & { serverName?: string; toolName?: string }) => {
      const serverName = payload?.serverName?.trim();
      const toolName = payload?.toolName?.trim();
      if (!serverName || !toolName || !validMcpName(serverName) || !validMcpName(toolName)) {
        return { ok: false, error: 'valid serverName and toolName are required' };
      }
      try {
        return await boundedRequest(event, async () => {
          const { agent, manager } = await managerFor(service, resolveAgentScope(payload));
          const registeredName = manager.getRegisteredToolName(serverName, toolName);
          const app = registeredName ? manager.getToolApp(registeredName) : undefined;
          if (!registeredName || !app || listMcpAppEntrypoints([app]).length === 0) {
            throw new Error('MCP App entrypoint is not available');
          }
          return { ok: true, value: await executeWithTimeout(agent, registeredName, {}) };
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

export function setupMcpAppIpc(service: CanvasAgentService): void {
  setupMcpAppNodeContextIpc();
  setupMcpAppEntrypointIpc(service);
  ipcMain.handle(
    'canvas-agent:mcp-app-list-resources',
    async (event, payload: AgentScopeRef & { serverName?: string; cursor?: string }) => {
      const serverName = payload?.serverName?.trim();
      if (!serverName || !validMcpName(serverName)) return { ok: false, error: 'valid serverName is required' };
      if (payload.cursor && payload.cursor.length > 1_024) return { ok: false, error: 'resource cursor is too long' };
      try {
        return await boundedRequest(event, async () => {
          const { manager } = await managerFor(service, resolveAgentScope(payload));
          return { ok: true, value: await manager.listResources(serverName, payload.cursor) };
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:mcp-app-read-resource',
    async (event, payload: AgentScopeRef & { serverName?: string; uri?: string }) => {
      const serverName = payload?.serverName?.trim();
      const uri = payload?.uri?.trim();
      if (!serverName || !validMcpName(serverName) || !uri || uri.length > 4_096) {
        return { ok: false, error: 'valid serverName and uri are required' };
      }
      try {
        return await boundedRequest(event, async () => {
          const { manager } = await managerFor(service, resolveAgentScope(payload));
          return { ok: true, value: await manager.readResource(serverName, uri) };
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // Keep channel registration synchronous; approval policy/state is App-only.
  let toolHandler: Promise<ReturnType<typeof import('./mcp-app-tool-handler').createMcpAppToolHandler>> | undefined;
  ipcMain.handle('canvas-agent:mcp-app-call-tool', async (event, payload) => {
    const handler = await (toolHandler ??= import('./mcp-app-tool-handler')
      .then(module => module.createMcpAppToolHandler(service)));
    return handler(event, payload);
  });
}
