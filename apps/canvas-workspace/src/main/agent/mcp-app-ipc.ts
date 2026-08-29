import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
} from 'electron';
import type { AgentScope, AgentScopeRef } from './types';
import type { CanvasAgentService } from './service';
import { serializeMcpAppToolArguments } from '../../shared/mcp-apps';
import { McpAppSessionApprovals } from './mcp-app-session-approvals';

const MAX_CONCURRENT_REQUESTS = 8;
const TOOL_TIMEOUT_MS = 30_000;
const activeRequests = new Map<number, number>();
const pendingApprovals = new Set<number>();
const sessionApprovals = new McpAppSessionApprovals();
const approvalCleanupRegistered = new Set<number>();

const registerApprovalCleanup = (event: IpcMainInvokeEvent): void => {
  const senderId = event.sender.id;
  if (approvalCleanupRegistered.has(senderId)) return;
  approvalCleanupRegistered.add(senderId);
  event.sender.once('destroyed', () => {
    approvalCleanupRegistered.delete(senderId);
    sessionApprovals.clear(senderId);
  });
};

export function resolveAgentScope(payload: AgentScopeRef): AgentScope {
  if (payload.scope?.kind === 'global') return { kind: 'global' };
  if (payload.scope?.kind === 'scheduled' && payload.scope.taskId) {
    return { kind: 'scheduled', taskId: payload.scope.taskId };
  }
  if (payload.scope?.kind === 'workspace' && payload.scope.workspaceId) {
    return { kind: 'workspace', workspaceId: payload.scope.workspaceId };
  }
  if (payload.workspaceId) return { kind: 'workspace', workspaceId: payload.workspaceId };
  return { kind: 'global' };
}

async function managerFor(service: CanvasAgentService, scope: AgentScope) {
  await service.activateScope(scope);
  const agent = service.getAgentForScope(scope);
  const manager = agent?.getMcpAppsManager();
  if (!manager) throw new Error('MCP runtime is not available');
  return { agent: agent!, manager };
}

function errorResult(error: unknown) {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function validMcpName(value: string): boolean {
  return value.length <= 128 && /^[a-zA-Z0-9_.-]+$/.test(value);
}

async function boundedRequest<T>(event: IpcMainInvokeEvent, run: () => Promise<T>): Promise<T> {
  const id = event.sender.id;
  const active = activeRequests.get(id) ?? 0;
  if (active >= MAX_CONCURRENT_REQUESTS) throw new Error('Too many concurrent MCP App requests');
  activeRequests.set(id, active + 1);
  try {
    return await run();
  } finally {
    const remaining = (activeRequests.get(id) ?? 1) - 1;
    if (remaining > 0) activeRequests.set(id, remaining);
    else activeRequests.delete(id);
  }
}

export function setupMcpAppIpc(service: CanvasAgentService): void {
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

  ipcMain.handle(
    'canvas-agent:mcp-app-call-tool',
    async (event, payload: AgentScopeRef & {
      serverName?: string;
      toolName?: string;
      arguments?: unknown;
    }) => {
      const serverName = payload?.serverName?.trim();
      const toolName = payload?.toolName?.trim();
      if (!serverName || !toolName || !validMcpName(serverName) || !validMcpName(toolName)) {
        return { ok: false, error: 'valid serverName and toolName are required' };
      }
      const senderId = event.sender.id;
      const scope = resolveAgentScope(payload);
      const approvedForSession = sessionApprovals.has(senderId, scope, serverName);
      if (!approvedForSession && pendingApprovals.has(senderId)) {
        return { ok: false, error: 'Another MCP App approval is pending' };
      }
      let detail: string;
      try {
        detail = serializeMcpAppToolArguments(payload.arguments);
      } catch (error) {
        return errorResult(error);
      }
      const options: MessageBoxOptions = {
        type: 'question',
        buttons: ['Allow', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Allow MCP App tool call?',
        message: `${serverName} wants to call ${toolName}`,
        detail,
        checkboxLabel: `Allow all calls from ${serverName} for this Pulse session`,
        checkboxChecked: false,
      };
      try {
        if (!approvedForSession) {
          pendingApprovals.add(senderId);
          try {
            const owner = BrowserWindow.fromWebContents(event.sender);
            const confirmation = owner
              ? await dialog.showMessageBox(owner, options)
              : await dialog.showMessageBox(options);
            if (confirmation.response !== 0) return { ok: false, error: 'Tool call was cancelled' };
            if (confirmation.checkboxChecked) {
              sessionApprovals.grant(senderId, scope, serverName);
              registerApprovalCleanup(event);
            }
          } finally {
            pendingApprovals.delete(senderId);
          }
        }
        return await boundedRequest(event, async () => {
          const { agent, manager } = await managerFor(service, scope);
          const registeredName = manager.getRegisteredToolName(serverName, toolName);
          if (!registeredName) throw new Error('Unknown or disabled MCP App tool');
          const abortController = new AbortController();
          const timeout = setTimeout(() => abortController.abort(), TOOL_TIMEOUT_MS);
          try {
            return {
              ok: true,
              value: await agent.executeMcpAppTool(
                registeredName,
                payload.arguments ?? {},
                abortController.signal,
              ),
            };
          } finally {
            clearTimeout(timeout);
          }
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
