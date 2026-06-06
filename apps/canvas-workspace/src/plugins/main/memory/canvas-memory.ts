/**
 * Granularity orchestration over the shared memory service.
 *
 * Write side:
 *   - sedimentTurn       → workspace bucket (serves session + workspace)
 *   - recordWorkspaceMemory → workspace bucket (agent-initiated explicit)
 *   - promoteToGlobalMemory → global bucket  (the ONLY path that writes global)
 * Read side:
 *   - recallMemory       → fan-out across the requested granularity, merged.
 */

import type { FileMemoryPluginService, MemoryItem } from 'pulse-coder-memory-plugin';
import type { AgentScope } from '../../../main/agent/types';
import { CANVAS_BUCKET_SESSION_ID, memoryKeysForScope } from './keys';
import { getCanvasMemoryService } from './canvas-memory-service';
import {
  bucketScore,
  clampRecallLimit,
  DEFAULT_RECALL_LIMIT,
  keywordMatches,
  mergeRankedMemories,
  toRecordPayload,
  type GlobalRecordKind,
  type MemoryGranularity,
  type MemoryOrigin,
  type RankedMemoryEntry,
  type RecalledMemory,
  type WorkspaceRecordKind,
} from './ranking';

/** Per-turn sedimentation → workspace bucket (serves session + workspace). */
export async function sedimentTurn(input: {
  scope: AgentScope;
  sessionId: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  if (!input.sessionId) return;
  if (!input.userText.trim() && !input.assistantText.trim()) return;
  const { workspaceKey } = memoryKeysForScope(input.scope);
  const service = await getCanvasMemoryService();
  await service.recordTurn({
    platformKey: workspaceKey,
    sessionId: input.sessionId,
    userText: input.userText,
    assistantText: input.assistantText,
    sourceType: 'daily-log',
  });
}

/** Agent-initiated explicit memory → workspace bucket (never global). */
export async function recordWorkspaceMemory(input: {
  scope: AgentScope;
  sessionId?: string;
  content: string;
  kind: WorkspaceRecordKind;
}): Promise<void> {
  const { workspaceKey } = memoryKeysForScope(input.scope);
  const service = await getCanvasMemoryService();
  const payload = toRecordPayload(input.content, input.kind);
  await service.recordTurn({
    platformKey: workspaceKey,
    sessionId: input.sessionId || CANVAS_BUCKET_SESSION_ID,
    userText: payload.userText,
    assistantText: payload.assistantText,
    sourceType: 'explicit',
  });
}

/** Explicit promotion → global bucket. The only writer of cross-workspace memory. */
export async function promoteToGlobalMemory(input: {
  scope: AgentScope;
  content: string;
  kind: GlobalRecordKind;
}): Promise<void> {
  const { globalKey } = memoryKeysForScope(input.scope);
  const service = await getCanvasMemoryService();
  const payload = toRecordPayload(input.content, input.kind);
  await service.recordTurn({
    platformKey: globalKey,
    sessionId: CANVAS_BUCKET_SESSION_ID,
    userText: payload.userText,
    assistantText: payload.assistantText,
    sourceType: 'explicit',
  });
}

/** Fan-out recall across the requested granularity, merged + re-ranked. */
export async function recallMemory(input: {
  scope: AgentScope;
  sessionId?: string;
  query: string;
  granularity: MemoryGranularity;
  limit?: number;
}): Promise<RecalledMemory[]> {
  const service = await getCanvasMemoryService();
  const { workspaceKey, globalKey } = memoryKeysForScope(input.scope);
  const limit = clampRecallLimit(input.limit ?? DEFAULT_RECALL_LIMIT);
  const perBucket = Math.min(8, Math.max(limit, 5));
  const { granularity } = input;

  const entries: RankedMemoryEntry[] = [];

  const wantWorkspaceBucket =
    granularity === 'session' || granularity === 'workspace' || granularity === 'all';
  const wantGlobalBucket = granularity === 'global' || granularity === 'all';

  if (wantWorkspaceBucket) {
    const items = await recallBucket(
      service,
      workspaceKey,
      input.sessionId || CANVAS_BUCKET_SESSION_ID,
      input.query,
      perBucket,
    );
    items.forEach((item, rank) => {
      const isSession = Boolean(input.sessionId) && item.sessionId === input.sessionId;
      // session granularity returns only the current session's slice.
      if (granularity === 'session' && !isSession) return;
      const origin: MemoryOrigin = isSession ? 'session' : 'workspace';
      entries.push({ origin, item, score: bucketScore(origin, rank) });
    });
  }

  // For the global chat agent globalKey === workspaceKey, so skip the duplicate query.
  if (wantGlobalBucket && globalKey !== workspaceKey) {
    const items = await recallBucket(service, globalKey, CANVAS_BUCKET_SESSION_ID, input.query, perBucket);
    items.forEach((item, rank) => {
      entries.push({ origin: 'global', item, score: bucketScore('global', rank) });
    });
  }

  return mergeRankedMemories(entries, limit);
}

/**
 * Gather a bucket's relevant items: semantic daily-log recall first, then
 * explicit (non-daily-log) records matched by keyword. The plugin's recall()
 * only searches daily-log, so explicit records (from record/promote) must be
 * surfaced via list() — otherwise they'd be write-only in pure-tool mode.
 */
async function recallBucket(
  service: FileMemoryPluginService,
  platformKey: string,
  sessionId: string,
  query: string,
  perBucket: number,
): Promise<MemoryItem[]> {
  const recalled = await service.recall({ platformKey, sessionId, query, limit: perBucket });
  const explicit = (await service.list({ platformKey, sessionId, limit: 50 }))
    .filter((item) => item.sourceType !== 'daily-log')
    .filter((item) => keywordMatches(query, item));

  const seen = new Set(recalled.items.map((item) => item.id));
  const merged: MemoryItem[] = [...recalled.items];
  for (const item of explicit) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}
