/**
 * Memory tools — explicit long-term memory for the Canvas Agent.
 *
 * Two scopes backed by ../memory-store: global memory (every chat) and
 * per-workspace memory. Workspace chat sees both and writes to the workspace
 * scope by default; global chat (empty workspaceId, matching the '' convention
 * in tools/index.ts) operates on global memory only. Reads are injected into
 * the system prompt each turn (see memory-store's buildMemoryPromptSection),
 * so these tools exist for writes and for explicit "what do you remember"
 * queries — not for routine recall.
 */

import { z } from 'zod';
import {
  forgetMemory,
  listMemory,
  saveMemory,
  type MemoryEntry,
  type MemoryScope,
} from '../memory-store';
import { listWorkspaces } from '../../canvas/workspaces';
import type { CanvasTool } from './types';

type ScopeName = 'global' | 'workspace';

function summarize(entry: MemoryEntry, scope: ScopeName): Record<string, unknown> {
  return {
    id: entry.id,
    scope,
    kind: entry.kind,
    content: entry.content,
    updatedAt: new Date(entry.updatedAt).toISOString(),
  };
}

const memoryKindSchema = z
  .enum(['preference', 'fact', 'decision', 'rule', 'note'])
  .optional()
  .describe('preference | fact (profile) | decision | rule | note (default).');

export function createMemoryTools(workspaceId: string): Record<string, CanvasTool> {
  const isGlobalChat = !workspaceId;
  const workspaceScope: MemoryScope | null = isGlobalChat
    ? null
    : { kind: 'workspace', workspaceId };
  const globalScope: MemoryScope = { kind: 'global' };

  const resolveScope = (name: ScopeName | undefined, fallback: ScopeName): MemoryScope => {
    const effective = isGlobalChat ? 'global' : name ?? fallback;
    return effective === 'workspace' && workspaceScope ? workspaceScope : globalScope;
  };

  const scopeDescription = isGlobalChat
    ? 'Global chat always targets GLOBAL memory.'
    : 'Defaults to this workspace; scope="global" for things that apply in every chat.';

  const memory_save: CanvasTool = {
    name: 'memory_save',
    description:
      'Save ONE distilled statement into long-term memory (usage policy: see the Memory section of the system prompt). ' +
      'Duplicate content updates the existing entry. ' +
      scopeDescription,
    inputSchema: z.object({
      content: z.string().min(1).describe('One distilled statement, max 500 chars.'),
      ...(isGlobalChat
        ? {}
        : {
            scope: z
              .enum(['workspace', 'global'])
              .optional()
              .describe('workspace (default) = this workspace only; global = every chat.'),
          }),
      kind: memoryKindSchema,
    }),
    execute: async (input: { content: string; scope?: ScopeName; kind?: MemoryEntry['kind'] }) => {
      const scope = resolveScope(input.scope, 'workspace');
      const scopeName: ScopeName = scope.kind === 'global' ? 'global' : 'workspace';
      try {
        const result = await saveMemory(scope, input.content, input.kind ?? 'note');
        return JSON.stringify({
          ok: true,
          updatedExisting: result.updated,
          entry: summarize(result.entry, scopeName),
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    },
  };

  const memory_list: CanvasTool = {
    name: 'memory_list',
    defer_loading: true,
    description:
      'List or search saved long-term memory entries with ids. Use when the user asks what you remember, before memory_forget, or to RETRIEVE fact/decision/note entries (those are not auto-injected into the prompt) — pass `query` to filter. ' +
      (isGlobalChat ? 'Global chat lists global memory.' : 'Lists global + this workspace by default.'),
    inputSchema: z.object({
      query: z.string().optional().describe('Case-insensitive substring filter over entry content.'),
      ...(isGlobalChat
        ? {}
        : {
            scope: z
              .enum(['all', 'workspace', 'global'])
              .optional()
              .describe('Defaults to all.'),
          }),
    }),
    execute: async (input: { scope?: 'all' | ScopeName; query?: string }) => {
      const wanted = isGlobalChat ? 'global' : input?.scope ?? 'all';
      const query = input?.query?.trim().toLowerCase();
      const matches = (entries: MemoryEntry[]): MemoryEntry[] =>
        query ? entries.filter((e) => e.content.toLowerCase().includes(query)) : entries;
      const sections: Record<string, unknown[]> = {};
      if (wanted === 'all' || wanted === 'global') {
        sections.global = matches(await listMemory(globalScope)).map((e) => summarize(e, 'global'));
      }
      if (workspaceScope && (wanted === 'all' || wanted === 'workspace')) {
        sections.workspace = matches(await listMemory(workspaceScope)).map((e) => summarize(e, 'workspace'));
      }
      const total = Object.values(sections).reduce((n, list) => n + list.length, 0);
      return JSON.stringify({ ok: true, total, ...(query ? { query } : {}), ...sections });
    },
  };

  const memory_forget: CanvasTool = {
    name: 'memory_forget',
    defer_loading: true,
    description:
      'Remove a memory entry by exact `id` ([mem-…] markers), or by a `query` substring matching exactly ONE entry; multiple matches remove nothing and return the candidates. ' +
      (isGlobalChat ? 'Global chat can only forget global memory.' : 'Searches this workspace first, then global.'),
    inputSchema: z.object({
      id: z.string().optional().describe('Exact entry id.'),
      query: z.string().optional().describe('Substring matching exactly one entry.'),
    }),
    execute: async (input: { id?: string; query?: string }) => {
      if (!input?.id && !input?.query?.trim()) {
        return JSON.stringify({ ok: false, error: 'Pass an id or a query.' });
      }
      const scopes: Array<{ scope: MemoryScope; name: ScopeName }> = [
        ...(workspaceScope ? [{ scope: workspaceScope, name: 'workspace' as const }] : []),
        { scope: globalScope, name: 'global' as const },
      ];

      const ambiguous: Array<Record<string, unknown>> = [];
      for (const { scope, name } of scopes) {
        const result = await forgetMemory(scope, { id: input.id, query: input.query });
        if (result.removed.length > 0) {
          return JSON.stringify({
            ok: true,
            removed: result.removed.map((e) => summarize(e, name)),
          });
        }
        if (result.ambiguous) {
          ambiguous.push(...result.ambiguous.map((e) => summarize(e, name)));
        }
      }

      if (ambiguous.length > 0) {
        return JSON.stringify({
          ok: false,
          error: 'Query matched multiple entries; nothing was removed. Re-issue memory_forget with the exact id.',
          matches: ambiguous,
        });
      }
      return JSON.stringify({ ok: false, error: 'No memory entry matched.' });
    },
  };

  const memory_adopt: CanvasTool = {
    name: 'memory_adopt',
    defer_loading: true,
    description:
      'Batch-write memory candidates the user just explicitly confirmed in a memory review/report (see the memory-review skill). ' +
      'Each candidate routes to its own scope — this is the ONLY path allowed to write another workspace\'s memory, so call it strictly with user-approved candidates, never for routine saving (that is memory_save).',
    inputSchema: z.object({
      candidates: z
        .array(
          z.object({
            content: z.string().min(1).describe('One distilled statement, max 500 chars.'),
            kind: memoryKindSchema,
            workspaceId: z.string().optional().describe('Target workspace id from the report; omit for global memory.'),
          }),
        )
        .min(1)
        .max(20)
        .describe('Only the candidates the user approved.'),
    }),
    execute: async (input: {
      candidates: Array<{ content: string; kind?: MemoryEntry['kind']; workspaceId?: string }>;
    }) => {
      const knownIds = new Set((await listWorkspaces()).workspaces.map((w) => w.id));
      const results: Array<Record<string, unknown>> = [];
      for (const candidate of input.candidates) {
        const targetWs = candidate.workspaceId?.trim();
        if (targetWs && !knownIds.has(targetWs)) {
          results.push({
            ok: false,
            content: candidate.content,
            error: `Unknown workspaceId "${targetWs}" — verify it with canvas_list_workspaces.`,
          });
          continue;
        }
        const scope: MemoryScope = targetWs ? { kind: 'workspace', workspaceId: targetWs } : globalScope;
        try {
          const saved = await saveMemory(scope, candidate.content, candidate.kind ?? 'note');
          results.push({
            ok: true,
            scope: targetWs ?? 'global',
            updatedExisting: saved.updated,
            id: saved.entry.id,
          });
        } catch (err) {
          results.push({
            ok: false,
            content: candidate.content,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const adopted = results.filter((r) => r.ok).length;
      return JSON.stringify({ ok: adopted === results.length, adopted, total: results.length, results });
    },
  };

  return { memory_save, memory_list, memory_forget, memory_adopt };
}
