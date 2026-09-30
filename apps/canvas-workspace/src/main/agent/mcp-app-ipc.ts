import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'crypto';
import type { AgentScope, AgentScopeRef } from './types';
import type { CanvasAgentService } from './service';
import {
  serializeMcpAppToolArguments,
  type McpAppToolApprovalResponse,
} from '../../shared/mcp-apps';
import { McpAppSessionApprovals } from './mcp-app-session-approvals';
import { listMcpAppEntrypoints } from './mcp-app-entrypoints';

const MAX_CONCURRENT_REQUESTS = 8;
const MAX_QUEUED_REQUESTS = 64;
const TOOL_TIMEOUT_MS = 30_000;
const activeRequests = new Map<number, number>();
const waitingRequests = new Map<number, Array<() => void>>();
interface PendingMcpAppApproval {
  requestId: string;
  scope: AgentScope;
  serverName: string;
  toolName: string;
  serializedArguments: string;
}
const pendingApprovals = new Map<number, PendingMcpAppApproval>();
const sessionApprovals = new McpAppSessionApprovals();
const approvalCleanupRegistered = new Set<number>();

const registerApprovalCleanup = (event: IpcMainInvokeEvent): void => {
  const senderId = event.sender.id;
  if (approvalCleanupRegistered.has(senderId)) return;
  approvalCleanupRegistered.add(senderId);
  event.sender.once('destroyed', () => {
    approvalCleanupRegistered.delete(senderId);
    pendingApprovals.delete(senderId);
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

function sameScope(left: AgentScope, right: AgentScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'workspace' && right.kind === 'workspace') {
    return left.workspaceId === right.workspaceId;
  }
  if (left.kind === 'scheduled' && right.kind === 'scheduled') {
    return left.taskId === right.taskId;
  }
  return left.kind === 'global' && right.kind === 'global';
}

async function acquireSlot(senderId: number): Promise<void> {
  const active = activeRequests.get(senderId) ?? 0;
  if (active < MAX_CONCURRENT_REQUESTS) {
    activeRequests.set(senderId, active + 1);
    return;
  }
  const queue = waitingRequests.get(senderId) ?? [];
  if (queue.length >= MAX_QUEUED_REQUESTS) throw new Error('Too many concurrent MCP App requests');
  // The slot is handed over by releaseSlot, so the active count stays unchanged here.
  await new Promise<void>((resolve) => {
    queue.push(resolve);
    waitingRequests.set(senderId, queue);
  });
}

function releaseSlot(senderId: number): void {
  const queue = waitingRequests.get(senderId);
  const next = queue?.shift();
  if (queue && queue.length === 0) waitingRequests.delete(senderId);
  if (next) {
    next();
    return;
  }
  const remaining = (activeRequests.get(senderId) ?? 1) - 1;
  if (remaining > 0) activeRequests.set(senderId, remaining);
  else activeRequests.delete(senderId);
}

async function boundedRequest<T>(event: IpcMainInvokeEvent, run: () => Promise<T>): Promise<T> {
  const id = event.sender.id;
  await acquireSlot(id);
  try {
    return await run();
  } finally {
    releaseSlot(id);
  }
}

async function executeWithTimeout(
  agent: Awaited<ReturnType<typeof managerFor>>['agent'],
  registeredName: string,
  args: unknown,
): Promise<unknown> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), TOOL_TIMEOUT_MS);
  try {
    return await agent.executeMcpAppTool(registeredName, args, abortController.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function setupMcpAppEntrypointIpc(service: CanvasAgentService): void {
  ipcMain.handle('canvas-agent:mcp-app-list-entrypoints', async (event, payload: AgentScopeRef) => {
    try {
      return await boundedRequest(event, async () => {
        const { manager } = await managerFor(service, resolveAgentScope(payload ?? {}));
        return { ok: true, value: listMcpAppEntrypoints(manager.listToolApps()) };
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

  ipcMain.handle(
    'canvas-agent:mcp-app-call-tool',
    async (event, payload: AgentScopeRef & {
      serverName?: string;
      toolName?: string;
      arguments?: unknown;
      approval?: McpAppToolApprovalResponse;
    }) => {
      const serverName = payload?.serverName?.trim();
      const toolName = payload?.toolName?.trim();
      if (!serverName || !toolName || !validMcpName(serverName) || !validMcpName(toolName)) {
        return { ok: false, error: 'valid serverName and toolName are required' };
      }
      const senderId = event.sender.id;
      const scope = resolveAgentScope(payload);
      const approvedForSession = sessionApprovals.has(senderId, scope, serverName);
      let inspectedArguments;
      try {
        inspectedArguments = serializeMcpAppToolArguments(payload.arguments);
      } catch (error) {
        return errorResult(error);
      }
      try {
        if (!approvedForSession) {
          const pending = pendingApprovals.get(senderId);
          if (!payload.approval) {
            if (pending) return { ok: false, error: 'Another MCP App approval is pending' };
            const requestId = randomUUID();
            pendingApprovals.set(senderId, {
              requestId,
              scope,
              serverName,
              toolName,
              serializedArguments: inspectedArguments.serialized,
            });
            registerApprovalCleanup(event);
            return {
              ok: false,
              approval: {
                requestId,
                serverName,
                toolName,
                argumentsPreview: inspectedArguments.preview,
                argumentsSize: inspectedArguments.size,
                truncated: inspectedArguments.truncated,
              },
            };
          }
          if (
            !pending
            || pending.requestId !== payload.approval.requestId
            || !sameScope(pending.scope, scope)
            || pending.serverName !== serverName
            || pending.toolName !== toolName
            || pending.serializedArguments !== inspectedArguments.serialized
          ) return { ok: false, error: 'MCP App approval is missing or expired' };
          pendingApprovals.delete(senderId);
          if (!['once', 'session', 'cancel'].includes(payload.approval.decision)) {
            return { ok: false, error: 'Invalid MCP App approval decision' };
          }
          if (payload.approval.decision === 'cancel') {
            return { ok: false, error: 'Tool call was cancelled' };
          }
          if (payload.approval.decision === 'session') {
            sessionApprovals.grant(senderId, scope, serverName);
          }
        }
        return await boundedRequest(event, async () => {
          const { agent, manager } = await managerFor(service, scope);
          const registeredName = manager.getRegisteredToolName(serverName, toolName);
          if (!registeredName) throw new Error('Unknown or disabled MCP App tool');
          return {
            ok: true,
            value: await executeWithTimeout(agent, registeredName, payload.arguments ?? {}),
          };
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
