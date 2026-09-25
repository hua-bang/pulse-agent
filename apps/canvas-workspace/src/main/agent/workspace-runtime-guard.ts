import { StorageError } from '@pulse-coder/storage';
import type { AgentScope } from './types';
import { getSqliteSessionStorage } from './sqlite-session-backend';

const trashing = new Set<string>();
const runs = new Map<string, number>();
const drains = new Set<(scope: AgentScope) => Promise<void>>();

export async function isWorkspaceTrashed(scope: AgentScope): Promise<boolean> {
  if (scope.kind !== 'workspace') return false;
  const storage = await getSqliteSessionStorage();
  return !!await storage?.workspaces.getTrashed(scope.workspaceId);
}

export async function assertWorkspaceAvailable(scope: AgentScope): Promise<void> {
  if (await isWorkspaceTrashed(scope)) {
    throw new StorageError('not_found', 'Workspace is in the trash; restore it before using its conversations.');
  }
}

/** Track the existing per-scope write tails, including services closing in the background. */
export function registerWorkspaceSessionDrain(drain: (scope: AgentScope) => Promise<void>): () => void {
  drains.add(drain);
  return () => { drains.delete(drain); };
}

/** A coarse workspace lease surrounds the existing per-conversation run coordinator. */
export async function withWorkspaceRun<T>(scope: AgentScope, operation: () => Promise<T>): Promise<T | null> {
  if (scope.kind !== 'workspace') return operation();
  const id = scope.workspaceId;
  if (trashing.has(id)) return null;
  runs.set(id, (runs.get(id) ?? 0) + 1);
  try {
    await assertWorkspaceAvailable(scope);
    return await operation();
  } finally {
    const remaining = (runs.get(id) ?? 1) - 1;
    if (remaining) runs.set(id, remaining);
    else runs.delete(id);
  }
}

export async function withWorkspaceTrashGuard<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
  if (trashing.has(workspaceId) || runs.has(workspaceId)) {
    throw new StorageError('storage_busy', 'This workspace has a running conversation; wait for it to finish before moving it to trash.');
  }
  trashing.add(workspaceId);
  try {
    const scope = { kind: 'workspace', workspaceId } as const;
    await Promise.all(Array.from(drains, drain => drain(scope)));
    return await operation();
  } finally {
    trashing.delete(workspaceId);
  }
}
