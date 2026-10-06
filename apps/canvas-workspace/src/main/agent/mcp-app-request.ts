import type { IpcMainInvokeEvent } from 'electron';
import type { AgentScope, AgentScopeRef } from './types';
import type { CanvasAgentService } from './service';

const MAX_CONCURRENT_REQUESTS = 8;
const MAX_QUEUED_REQUESTS = 64;
const TOOL_TIMEOUT_MS = 30_000;
const activeRequests = new Map<number, number>();
const waitingRequests = new Map<number, Array<() => void>>();

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

export async function managerFor(service: CanvasAgentService, scope: AgentScope) {
  await service.activateScope(scope);
  const agent = service.getAgentForScope(scope);
  const manager = agent?.getMcpAppsManager();
  if (!manager) throw new Error('MCP runtime is not available');
  return { agent: agent!, manager };
}

export function errorResult(error: unknown) {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/**
 * Server names are user config keys (spaces and slashes are legal) and every
 * lookup goes through the manager, so only bound the size and reject control
 * characters here.
 */
export function validMcpName(value: string): boolean {
  return value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
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

export async function boundedRequest<T>(event: IpcMainInvokeEvent, run: () => Promise<T>): Promise<T> {
  const id = event.sender.id;
  await acquireSlot(id);
  try {
    return await run();
  } finally {
    releaseSlot(id);
  }
}

export async function executeWithTimeout(
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
