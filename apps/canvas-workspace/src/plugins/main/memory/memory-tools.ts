/**
 * Canvas memory tools (pure on-demand; nothing is auto-injected into the prompt).
 *
 *   - canvas_memory_recall  : fan-out recall at session | workspace | global | all
 *   - canvas_memory_record  : persist a durable preference/rule/fix/profile (workspace)
 *   - canvas_memory_promote : promote a fact/rule to GLOBAL memory (explicit only)
 *
 * Tools close over `scope` and a `getSessionId` callback (canvas tools receive
 * no run context), so no AsyncLocalStorage / withRunContext is needed.
 */

import { z } from 'zod';
import type { CanvasTool } from '../../../main/agent/tools/types';
import type { AgentScope } from '../../../main/agent/types';
import { promoteToGlobalMemory, recallMemory, recordWorkspaceMemory } from './canvas-memory';
import type { MemoryGranularity } from './ranking';

export interface CanvasMemoryToolDeps {
  scope: AgentScope;
  getSessionId: () => string | undefined;
}

const RECALL_SCHEMA = z.object({
  query: z.string().min(1).describe('What to recall, in natural language.'),
  granularity: z
    .enum(['session', 'workspace', 'global', 'all'])
    .optional()
    .describe('session = current conversation only; workspace = this workspace; global = cross-workspace; all = merge. Defaults to all.'),
  limit: z.number().int().min(1).max(8).optional().describe('Max items to return (default 6).'),
});

const RECORD_SCHEMA = z.object({
  content: z.string().min(1).describe('The memory content to persist for this workspace.'),
  kind: z
    .enum(['preference', 'rule', 'fix', 'profile'])
    .optional()
    .describe('rule/profile are workspace-wide; preference/fix are session-level. Defaults to preference.'),
});

const PROMOTE_SCHEMA = z.object({
  content: z.string().min(1).describe('The fact/rule to remember across ALL workspaces.'),
  kind: z
    .enum(['rule', 'profile'])
    .optional()
    .describe('Global memory kind. Defaults to profile. Use only when the user clearly wants it remembered everywhere.'),
});

export function createCanvasMemoryTools(deps: CanvasMemoryToolDeps): Record<string, CanvasTool> {
  const recall: CanvasTool = {
    name: 'canvas_memory_recall',
    description:
      'Recall distilled memory (preferences/rules/decisions/fixes/facts) relevant to the current task. Choose a granularity. Does not return verbatim chat — use canvas_session_read for that.',
    inputSchema: RECALL_SCHEMA,
    execute: async (input) => {
      const query = String(input.query ?? '').trim();
      if (!query) return JSON.stringify({ ok: false, error: 'query is required' });
      const granularity = (input.granularity ?? 'all') as MemoryGranularity;
      const items = await recallMemory({
        scope: deps.scope,
        sessionId: deps.getSessionId(),
        query,
        granularity,
        limit: input.limit,
      });
      return JSON.stringify({
        ok: true,
        query,
        granularity,
        count: items.length,
        items: items.map(({ origin, item }) => ({
          origin,
          id: item.id,
          scope: item.scope,
          type: item.type,
          summary: item.summary,
          content: item.content,
          pinned: item.pinned,
          sessionId: item.sessionId,
          updatedAt: item.updatedAt,
        })),
      });
    },
  };

  const record: CanvasTool = {
    name: 'canvas_memory_record',
    description:
      'Persist a durable preference/rule/fix/profile for THIS workspace. Use sparingly, only for stable facts worth remembering. Does not write global memory.',
    inputSchema: RECORD_SCHEMA,
    execute: async (input) => {
      const content = String(input.content ?? '').trim();
      if (!content) return JSON.stringify({ ok: false, error: 'content is required' });
      const kind = input.kind ?? 'preference';
      await recordWorkspaceMemory({
        scope: deps.scope,
        sessionId: deps.getSessionId(),
        content,
        kind,
      });
      return JSON.stringify({ ok: true, scope: 'workspace', kind });
    },
  };

  const promote: CanvasTool = {
    name: 'canvas_memory_promote',
    description:
      'Promote a fact/rule to GLOBAL memory shared across every workspace. Use only when the user explicitly wants something remembered everywhere.',
    inputSchema: PROMOTE_SCHEMA,
    execute: async (input) => {
      const content = String(input.content ?? '').trim();
      if (!content) return JSON.stringify({ ok: false, error: 'content is required' });
      const kind = input.kind ?? 'profile';
      await promoteToGlobalMemory({ scope: deps.scope, content, kind });
      return JSON.stringify({ ok: true, scope: 'global', kind });
    },
  };

  return {
    canvas_memory_recall: recall,
    canvas_memory_record: record,
    canvas_memory_promote: promote,
  };
}
