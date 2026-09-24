type FlushWorkspace = () => Promise<void>;

const writers = new Map<string, Set<FlushWorkspace>>();

/** Mounted documents retain ownership of their drafts and persistence errors. */
export function registerWorkspacePersistence(workspaceId: string, flush: FlushWorkspace): () => void {
  const callbacks = writers.get(workspaceId) ?? new Set<FlushWorkspace>();
  callbacks.add(flush);
  writers.set(workspaceId, callbacks);
  return () => {
    callbacks.delete(flush);
    if (!callbacks.size && writers.get(workspaceId) === callbacks) writers.delete(workspaceId);
  };
}

/** Finish local edits before a user-requested workspace lifecycle transition. */
export async function flushWorkspacePersistence(workspaceId: string): Promise<void> {
  for (const flush of [...(writers.get(workspaceId) ?? [])]) await flush();
}
