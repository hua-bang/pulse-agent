import type { IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'crypto';
import type { AgentScope, AgentScopeRef } from '../types';
import type { CanvasAgentService } from '../service';
import { serializeMcpAppToolArguments, type McpAppToolApprovalResponse } from '../../../shared/mcp-apps';
import { classifyCanvasToolOperation } from '../tool-policy';
import { McpAppPendingApprovals } from './mcp-app-pending-approvals';
import { McpAppSessionApprovals } from './mcp-app-session-approvals';
import { boundedRequest, errorResult, executeWithTimeout, managerFor, resolveAgentScope, validMcpName } from './mcp-app-request';

interface PendingMcpAppApproval {
  requestId: string;
  scope: AgentScope;
  serverName: string;
  toolName: string;
  serializedArguments: string;
}
const pendingApprovals = new McpAppPendingApprovals<PendingMcpAppApproval>();
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

function matchesApproval(
  pending: PendingMcpAppApproval | undefined,
  scope: AgentScope,
  serverName: string,
  toolName: string,
  serializedArguments: string,
  requestId: string,
): boolean {
  return Boolean(pending && pending.requestId === requestId && sameScope(pending.scope, scope)
    && pending.serverName === serverName && pending.toolName === toolName
    && pending.serializedArguments === serializedArguments);
}

export function createMcpAppToolHandler(service: CanvasAgentService) {
  return async (event: IpcMainInvokeEvent, payload: AgentScopeRef & {
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
    let inspectedArguments;
    try {
      inspectedArguments = serializeMcpAppToolArguments(payload.arguments);
    } catch (error) {
      return errorResult(error);
    }
    // Cancellation must release its exact pending request even if the server
    // was disabled or disconnected while the dialog was visible.
    if (payload.approval?.decision === 'cancel') {
      if (!matchesApproval(pendingApprovals.get(senderId), scope, serverName, toolName,
        inspectedArguments.serialized, payload.approval.requestId)) {
        return { ok: false, error: 'MCP App approval is missing or expired' };
      }
      pendingApprovals.delete(senderId);
      return { ok: false, error: 'Tool call was cancelled' };
    }
    let reservedApproval = false;
    try {
      // Resolve enabled tools before asking. Use the host's existing classifier,
      // with the bare tool name so server names cannot alter operation policy.
      const { manager } = await managerFor(service, scope);
      const registeredName = manager.getRegisteredToolName(serverName, toolName);
      if (!registeredName) throw new Error('Unknown or disabled MCP App tool');
      const readOnly = classifyCanvasToolOperation(`mcp_app_${toolName}`) === 'read';
      if (!readOnly && !payload.approval && !sessionApprovals.has(senderId, scope, serverName)) {
        registerApprovalCleanup(event);
        await pendingApprovals.wait(senderId, () => event.sender.isDestroyed?.() ?? false);
        reservedApproval = true;
      }
      // A prior queued request may have granted this server while we waited.
      const approvedForSession = sessionApprovals.has(senderId, scope, serverName);
      if (reservedApproval && approvedForSession) {
        pendingApprovals.delete(senderId);
        reservedApproval = false;
      }
      if (!readOnly && !approvedForSession) {
        const pending = pendingApprovals.get(senderId);
        if (!payload.approval) {
          const requestId = randomUUID();
          pendingApprovals.set(senderId, {
            requestId,
            scope,
            serverName,
            toolName,
            serializedArguments: inspectedArguments.serialized,
          });
          reservedApproval = false;
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
        if (!matchesApproval(pending, scope, serverName, toolName,
          inspectedArguments.serialized, payload.approval.requestId)) {
          return { ok: false, error: 'MCP App approval is missing or expired' };
        }
        pendingApprovals.delete(senderId);
        if (!['once', 'session', 'cancel'].includes(payload.approval.decision)) {
          return { ok: false, error: 'Invalid MCP App approval decision' };
        }
        if (payload.approval.decision === 'session') {
          sessionApprovals.grant(senderId, scope, serverName);
        }
      }
      return await boundedRequest(event, async () => {
        const { agent, manager } = await managerFor(service, scope);
        const currentName = manager.getRegisteredToolName(serverName, toolName);
        if (!currentName) throw new Error('Unknown or disabled MCP App tool');
        return {
          ok: true,
          value: await executeWithTimeout(agent, currentName, payload.arguments ?? {}),
        };
      });
    } catch (error) {
      // A failed confirmation has already dismissed its renderer dialog.
      // Release only its exact pending request; never clear a newer dialog.
      if (reservedApproval || (payload.approval && matchesApproval(
        pendingApprovals.get(senderId), scope, serverName, toolName,
        inspectedArguments.serialized, payload.approval.requestId,
      ))) pendingApprovals.delete(senderId);
      return errorResult(error);
    }
  };
}
