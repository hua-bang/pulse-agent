/**
 * Knowledge tagging tool — the one canvas write allowed in global chat.
 *
 * `canvas_tag_node` adds / removes / replaces knowledge-layer tags on one or
 * MANY nodes in a single call (batch), so a skill that scanned the system for
 * "nodes that should get [AI]" can apply the tag to the whole set at once. It
 * only touches `properties.tags` on the workspace-node record — never the
 * canvas layout — which is why it is safe to expose in global chat where other
 * mutations stay disabled.
 *
 * Storage convention: tags are stored as canonical tag IDS (slugs), matching
 * the renderer's tag picker (`mergeTagDefinitions` treats stored tokens as
 * ids). Inputs may be tag names OR ids; new names are auto-registered in the
 * global tag store. Writes go straight to disk; the renderer re-reads on its
 * next `workspace-node:list`, same as the existing upsert path.
 */

import { z } from 'zod';
import {
  readWorkspaceNode,
  writeWorkspaceNode,
  WORKSPACE_NODE_SCHEMA_VERSION,
  type WorkspaceNodeRecord,
} from '../../canvas/nodes/store';
import { readKnowledgeTags, upsertKnowledgeTag } from '../../canvas/nodes/tags';
import { broadcastWorkspaceNodesChanged } from '../../canvas/nodes/broadcast';
import { loadCanvas } from './_shared/canvas-io';
import type { CanvasNode, CanvasTool } from './types';

function recordTags(record: WorkspaceNodeRecord | null | undefined): string[] {
  const raw = record?.properties?.tags;
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
}

/** Map every lowercased tag token (id OR name) to its canonical tag id. */
function buildTagIndex(tags: Array<{ id: string; name: string }>): Map<string, string> {
  const index = new Map<string, string>();
  for (const tag of tags) {
    index.set(tag.id.toLowerCase(), tag.id);
    index.set(tag.name.toLowerCase(), tag.id);
  }
  return index;
}

/** Resolve a stored token to its canonical id when known, else keep it as-is. */
function canonical(token: string, index: Map<string, string>): string {
  return index.get(token.trim().toLowerCase()) ?? token.trim();
}

interface TagOps {
  addIds: string[];
  removeKeys: Set<string>;
  setIds: string[] | null;
}

/** Pure tag-set computation for a single node. */
function computeNextTags(existing: string[], ops: TagOps, index: Map<string, string>): string[] {
  if (ops.setIds) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ops.setIds) {
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(id);
    }
    return out;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (token: string) => {
    const key = token.toLowerCase();
    if (ops.removeKeys.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(token);
  };
  for (const token of existing) push(canonical(token, index));
  for (const id of ops.addIds) push(id);
  return out;
}

const tagListSchema = z.array(z.string()).optional();

const tagNodeSchema = z.object({
  nodes: z
    .array(
      z.object({
        nodeId: z.string().describe('The canvas node id to tag — use the EXACT id from canvas_list_nodes, never a guess/title.'),
        workspaceId: z.string().optional().describe('Workspace of this node. Falls back to the top-level workspaceId.'),
        addTags: tagListSchema.describe('Tags to add for THIS node. A NON-EMPTY array overrides top-level addTags; an empty array [] is IGNORED.'),
        removeTags: tagListSchema.describe('Tags to remove for THIS node. Non-empty overrides top-level; [] is IGNORED.'),
        setTags: tagListSchema.describe('Replace THIS node\'s entire tag set. Non-empty overrides top-level and ignores add/remove for this node; [] is IGNORED (use clearTags to clear).'),
        clearTags: z.boolean().optional().describe('Set true to remove ALL tags from THIS node.'),
      }),
    )
    .min(1)
    .max(200)
    .describe('The nodes to tag (batch). Each needs a nodeId; workspaceId can be given here or once at the top level.'),
  workspaceId: z.string().optional().describe('Default workspace id applied to every node that does not set its own.'),
  addTags: tagListSchema.describe('Tags to add (merge, keeping existing tags) on every node. Empty array [] = no-op.'),
  removeTags: tagListSchema.describe('Tags to remove on every node. Empty array [] = no-op.'),
  setTags: tagListSchema.describe('Replace the entire tag set on every node (ignores add/remove). Empty array [] = no-op (use clearTags to clear).'),
  clearTags: z.boolean().optional().describe('Set true to clear ALL tags on every node unless the node overrides.'),
});

type TagNodeInput = z.infer<typeof tagNodeSchema>;

export function createTaggingTools(): Record<string, CanvasTool> {
  return {
    canvas_tag_node: {
      name: 'canvas_tag_node',
      description:
        'Add, remove, or replace knowledge tags on one or more nodes — in a single batched call. ' +
        'This is the ONLY canvas write available in global chat: it edits knowledge-layer tags (`properties.tags`) only, never the canvas layout. ' +
        'Pass `nodes: [{ nodeId, workspaceId }]` (workspaceId may be set once at the top level for all). The COMMON case: put the tag once in top-level `addTags` and leave the per-node tag fields empty/omitted; only set per-node tag fields when a node genuinely needs DIFFERENT tags. ' +
        '`addTags` merges, `removeTags` drops, `setTags` replaces, `clearTags:true` clears. ' +
        'IMPORTANT semantics: empty arrays ([]) are IGNORED (treated as "not provided") — they do NOT override the top-level and do NOT clear; to clear use `clearTags:true`. A non-empty node-level field overrides the top-level for that node. ' +
        'The result reports per-node `changed` (and a top-level `changed` count) — a node can be `ok` but `changed:false` (e.g. the tag was already there or the op resolved to nothing), so do NOT treat `ok` alone as "applied". ' +
        'Use the EXACT nodeId/workspaceId from `canvas_list_nodes`; run `canvas_list_tags` first for exact tag names.',
      inputSchema: tagNodeSchema,
      execute: async (input: TagNodeInput) => {
        const top = input ?? ({} as TagNodeInput);
        const items = Array.isArray(top.nodes) ? top.nodes : [];
        if (items.length === 0) {
          return JSON.stringify({ ok: false, error: 'No nodes provided.' });
        }

        // Effective op tokens per item. An empty array carries no instruction,
        // so it is IGNORED (not an override, not a clear) and we fall back to the
        // top-level. A non-empty node-level field overrides the top-level one.
        // To clear, callers must pass clearTags:true.
        const nonEmpty = (arr?: string[]): string[] | undefined =>
          Array.isArray(arr) && arr.length > 0 ? arr : undefined;
        const isEmptyArray = (arr?: string[]): boolean => Array.isArray(arr) && arr.length === 0;
        let sawIgnoredEmpty = false;
        let overrodeCount = 0;

        const effective = items.map((item) => {
          if (isEmptyArray(item.addTags) || isEmptyArray(item.removeTags) || isEmptyArray(item.setTags)) {
            sawIgnoredEmpty = true;
          }
          const addTags = nonEmpty(item.addTags) ?? nonEmpty(top.addTags);
          const removeTags = nonEmpty(item.removeTags) ?? nonEmpty(top.removeTags);
          const setTags = nonEmpty(item.setTags) ?? nonEmpty(top.setTags);
          const clearTags = item.clearTags ?? top.clearTags ?? false;
          const overrodeTop = Boolean(
            (nonEmpty(item.addTags) && nonEmpty(top.addTags)) ||
            (nonEmpty(item.removeTags) && nonEmpty(top.removeTags)) ||
            (nonEmpty(item.setTags) && nonEmpty(top.setTags)),
          );
          if (overrodeTop) overrodeCount += 1;
          return {
            nodeId: item.nodeId,
            workspaceId: item.workspaceId ?? top.workspaceId,
            addTags,
            removeTags,
            setTags,
            clearTags,
            overrodeTop,
          };
        });

        // Pass 1: resolve every add/set token to a canonical id, registering
        // new tag names. Cache by lowercased token so each is resolved once.
        const tokenToId = new Map<string, string>();
        const ensureId = async (token: string): Promise<string | null> => {
          const trimmed = token.trim();
          if (!trimmed) return null;
          const lower = trimmed.toLowerCase();
          const cached = tokenToId.get(lower);
          if (cached) return cached;
          const defs = await readKnowledgeTags();
          const found = defs.find(
            (d) => d.id.toLowerCase() === lower || d.name.toLowerCase() === lower,
          );
          const id = found ? found.id : (await upsertKnowledgeTag({ name: trimmed })).id;
          tokenToId.set(lower, id);
          return id;
        };
        for (const e of effective) {
          for (const token of [...(e.setTags ?? []), ...(e.addTags ?? [])]) {
            await ensureId(token);
          }
        }

        // Final tag index (includes any tag just registered) for canonicalizing
        // existing tokens and resolving removals.
        const index = buildTagIndex(await readKnowledgeTags());
        const toIds = (tokens: string[] | undefined): string[] =>
          (tokens ?? [])
            .map((t) => tokenToId.get(t.trim().toLowerCase()) ?? null)
            .filter((id): id is string => !!id);
        const toRemoveKeys = (tokens: string[] | undefined): Set<string> =>
          new Set((tokens ?? []).map((t) => canonical(t, index).toLowerCase()).filter(Boolean));

        // Cache per-workspace canvas + records so a batch over one workspace
        // reads it once. Records are re-read per node so sequential writes to
        // the same node compound correctly.
        const canvasCache = new Map<string, Map<string, CanvasNode>>();
        const loadCanvasNodes = async (wsId: string): Promise<Map<string, CanvasNode>> => {
          const cached = canvasCache.get(wsId);
          if (cached) return cached;
          const canvas = await loadCanvas(wsId);
          const map = new Map<string, CanvasNode>((canvas?.nodes ?? []).map((n) => [n.id, n] as const));
          canvasCache.set(wsId, map);
          return map;
        };

        const sameTags = (a: string[], b: string[]): boolean => {
          if (a.length !== b.length) return false;
          const sa = new Set(a.map((t) => t.toLowerCase()));
          return b.every((t) => sa.has(t.toLowerCase()));
        };

        const results: Array<Record<string, unknown>> = [];
        const touched = new Set<string>();
        let changed = 0;
        let unchanged = 0;
        let failed = 0;

        for (const e of effective) {
          const workspaceId = e.workspaceId;
          if (!workspaceId) {
            failed += 1;
            results.push({ nodeId: e.nodeId, ok: false, error: 'Missing workspaceId (set it on the node or at the top level).' });
            continue;
          }
          const hasOp = Boolean(e.setTags) || e.clearTags || Boolean(e.addTags) || Boolean(e.removeTags);
          if (!hasOp) {
            failed += 1;
            results.push({
              workspaceId,
              nodeId: e.nodeId,
              ok: false,
              error: 'No tag operation. Pass a non-empty addTags / removeTags / setTags, or clearTags:true. (Empty arrays are ignored.)',
            });
            continue;
          }

          const canvasNodes = await loadCanvasNodes(workspaceId);
          const canvasNode = canvasNodes.get(e.nodeId);
          const record = await readWorkspaceNode(workspaceId, e.nodeId);
          if (!canvasNode && !record) {
            failed += 1;
            results.push({ workspaceId, nodeId: e.nodeId, ok: false, error: 'Node not found in this workspace.' });
            continue;
          }

          // setTags (non-empty) replaces; clearTags clears (= set to []);
          // otherwise add/remove merge.
          const setIds = e.setTags ? toIds(e.setTags) : e.clearTags ? [] : null;
          const ops: TagOps = {
            addIds: setIds === null ? toIds(e.addTags) : [],
            removeKeys: setIds === null ? toRemoveKeys(e.removeTags) : new Set<string>(),
            setIds,
          };
          const before = recordTags(record);
          const nextTags = computeNextTags(before, ops, index);

          // No actual change → report ok-but-unchanged instead of a fake success,
          // and skip the write (don't materialise an empty record either).
          if (sameTags(before, nextTags)) {
            unchanged += 1;
            results.push({
              workspaceId,
              nodeId: e.nodeId,
              ok: true,
              changed: false,
              tags: nextTags,
              note: nextTags.length === 0 ? 'no tags applied (op resolved to empty)' : 'unchanged (tags already as requested)',
              ...(e.overrodeTop ? { overrodeTopLevel: true } : {}),
            });
            continue;
          }

          const now = Date.now();
          const next: WorkspaceNodeRecord = record
            ? {
                ...record,
                properties: { ...(record.properties ?? {}), tags: nextTags },
                updatedAt: now,
              }
            : {
                schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
                id: e.nodeId,
                type: canvasNode?.type ?? 'note',
                ...(canvasNode?.title ? { title: canvasNode.title } : {}),
                data: {},
                properties: { tags: nextTags },
                createdAt: now,
                updatedAt: now,
              };
          await writeWorkspaceNode(workspaceId, next);
          touched.add(workspaceId);
          changed += 1;
          results.push({
            workspaceId,
            nodeId: e.nodeId,
            ok: true,
            changed: true,
            created: !record,
            tags: nextTags,
            ...(e.overrodeTop ? { overrodeTopLevel: true } : {}),
          });
        }

        // Tell open Graph / Nodes views to reload so chat-applied tags show up
        // live (the renderer is otherwise pull-only and would stay stale).
        broadcastWorkspaceNodesChanged([...touched]);

        const notes: string[] = [];
        if (sawIgnoredEmpty) {
          notes.push('Empty-array tag fields were ignored (treated as not provided). To clear tags use clearTags:true.');
        }
        if (overrodeCount > 0) {
          notes.push(`Node-level tags overrode the top-level for ${overrodeCount} node(s).`);
        }
        if (unchanged > 0) {
          notes.push(`${unchanged} node(s) are ok but unchanged — check each node's "changed" flag, not just "ok".`);
        }

        return JSON.stringify({
          ok: failed === 0,
          total: results.length,
          changed,
          unchanged,
          failed,
          ...(notes.length ? { notes } : {}),
          results,
        });
      },
    },
  };
}

// Re-exported for unit tests.
export const __testing = { computeNextTags, buildTagIndex, canonical };
