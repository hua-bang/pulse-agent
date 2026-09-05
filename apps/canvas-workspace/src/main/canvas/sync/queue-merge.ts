export interface QueueMergeNode {
  type: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Preserve newer Main-owned launch queue state across a stale renderer save. */
export function preserveMainOwnedQueueFields<T extends QueueMergeNode>(
  memoryNode: T,
  diskNode: T,
): T {
  if (memoryNode.type !== 'agent') return memoryNode;
  const memoryData = memoryNode.data ?? {};
  const diskData = diskNode.data ?? {};
  if (typeof diskData.agentTeamId !== 'string') return memoryNode;
  const diskRevision = typeof diskData.queueRev === 'number' ? diskData.queueRev : 0;
  const memoryRevision = typeof memoryData.queueRev === 'number' ? memoryData.queueRev : 0;
  if (diskRevision <= memoryRevision) return memoryNode;

  return {
    ...memoryNode,
    data: {
      ...memoryData,
      inlinePrompt: diskData.inlinePrompt,
      promptFile: diskData.promptFile,
      lastInitPrompt: diskData.lastInitPrompt,
      status: diskData.status,
      viewMode: diskData.viewMode,
      queueRev: diskRevision,
    },
  };
}
