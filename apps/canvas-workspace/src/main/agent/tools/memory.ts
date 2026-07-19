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
  .describe('What kind of memory this is. preference=how the user likes things done, fact=stable user/profile fact, decision=a choice made in this project, rule=a standing constraint, note=anything else. Defaults to note.');

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
    ? 'This is global chat, so all memory operations target GLOBAL memory.'
    : 'Defaults to this workspace\'s memory; pass scope="global" only for things that should apply in every chat (user preferences, profile facts).';

  const memory_save: CanvasTool = {
    name: 'memory_save',
    description:
      'Save ONE distilled statement into long-term memory so future chats remember it. ' +
      'Use when the user says 记住/remember, states a stable preference / profile fact / standing rule, or when a hard-won decision or fix is worth keeping. ' +
      'Do NOT save transient task state, whole documents, or content already stored on the canvas. ' +
      'Saving content that matches an existing entry updates that entry instead of duplicating it. ' +
      scopeDescription,
    inputSchema: z.object({
      content: z.string().min(1).describe('The single statement to remember, distilled to one or two sentences (max 500 chars).'),
      ...(isGlobalChat
        ? {}
        : {
            scope: z
              .enum(['workspace', 'global'])
              .optional()
              .describe('Where to save. workspace (default) = this workspace only; global = applies in every chat.'),
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
      'List saved long-term memory entries with their ids. ' +
      'Use when the user asks what you remember, or to find an entry id before memory_forget. ' +
      (isGlobalChat ? 'Global chat lists global memory.' : 'Lists both global and this workspace\'s memory by default.'),
    inputSchema: z.object({
      ...(isGlobalChat
        ? {}
        : {
            scope: z
              .enum(['all', 'workspace', 'global'])
              .optional()
              .describe('Which scope to list. Defaults to all.'),
          }),
    }),
    execute: async (input: { scope?: 'all' | ScopeName }) => {
      const wanted = isGlobalChat ? 'global' : input?.scope ?? 'all';
      const sections: Record<string, unknown[]> = {};
      if (wanted === 'all' || wanted === 'global') {
        sections.global = (await listMemory(globalScope)).map((e) => summarize(e, 'global'));
      }
      if (workspaceScope && (wanted === 'all' || wanted === 'workspace')) {
        sections.workspace = (await listMemory(workspaceScope)).map((e) => summarize(e, 'workspace'));
      }
      const total = Object.values(sections).reduce((n, list) => n + list.length, 0);
      return JSON.stringify({ ok: true, total, ...sections });
    },
  };

  const memory_forget: CanvasTool = {
    name: 'memory_forget',
    defer_loading: true,
    description:
      'Remove a long-term memory entry. Pass its exact `id` (from memory_list or the [mem-…] markers in the Memory section), or a `query` substring that matches exactly one entry. ' +
      'A query matching several entries removes nothing and returns the candidates — re-issue with the right id. ' +
      'Use when the user asks to forget something or a saved entry is wrong or stale. ' +
      (isGlobalChat ? 'Global chat can only forget global memory.' : 'Searches this workspace\'s memory first, then global memory.'),
    inputSchema: z.object({
      id: z.string().optional().describe('Exact entry id to remove, e.g. mem-1699999999-ab12cd.'),
      query: z.string().optional().describe('Case-insensitive substring of the entry content. Must match exactly one entry.'),
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

  return { memory_save, memory_list, memory_forget };
}
