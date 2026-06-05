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
        nodeId: z.string().describe('The canvas/workspace node id to tag.'),
        workspaceId: z.string().optional().describe('Workspace of this node. Falls back to the top-level workspaceId.'),
        addTags: tagListSchema.describe('Tags to add for THIS node (overrides the top-level addTags).'),
        removeTags: tagListSchema.describe('Tags to remove for THIS node (overrides the top-level removeTags).'),
        setTags: tagListSchema.describe('Replace THIS node\'s entire tag set (overrides add/remove for this node).'),
      }),
    )
    .min(1)
    .max(200)
    .describe('The nodes to tag (batch). Each needs a nodeId; workspaceId can be given here or once at the top level.'),
  workspaceId: z.string().optional().describe('Default workspace id applied to every node that does not set its own.'),
  addTags: tagListSchema.describe('Tags to add (merge, keeping existing tags) on every node unless the node overrides.'),
  removeTags: tagListSchema.describe('Tags to remove on every node unless the node overrides.'),
  setTags: tagListSchema.describe('Replace the entire tag set on every node (ignores add/remove) unless the node overrides.'),
});

type TagNodeInput = z.infer<typeof tagNodeSchema>;

export function createTaggingTools(): Record<string, CanvasTool> {
  return {
    canvas_tag_node: {
      name: 'canvas_tag_node',
      description:
        'Add, remove, or replace knowledge tags on one or more nodes — in a single batched call. ' +
        'This is the ONLY canvas write available in global chat: it edits knowledge-layer tags (`properties.tags`) only, never the canvas layout. ' +
        'Pass `nodes: [{ nodeId, workspaceId }]` (workspaceId may be set once at the top level for all of them). Apply the SAME tags to the whole batch via top-level `addTags` / `removeTags` / `setTags`, or override per node. ' +
        '`addTags` merges (keeps existing tags), `removeTags` drops them, `setTags` replaces a node\'s entire tag set (use `setTags: []` to clear). Tags may be given by name or id; unknown names are auto-registered. ' +
        'Run `canvas_list_nodes` / `canvas_list_tags` first to find candidates and exact tag names.',
      inputSchema: tagNodeSchema,
      execute: async (input: TagNodeInput) => {
        const top = input ?? ({} as TagNodeInput);
        const items = Array.isArray(top.nodes) ? top.nodes : [];
        if (items.length === 0) {
          return JSON.stringify({ ok: false, error: 'No nodes provided.' });
        }

        // Effective op tokens per item (item overrides top-level field-by-field).
        const effective = items.map((item) => {
          const setTags = item.setTags ?? top.setTags;
          return {
            nodeId: item.nodeId,
            workspaceId: item.workspaceId ?? top.workspaceId,
            setTags,
            addTags: setTags ? undefined : item.addTags ?? top.addTags,
            removeTags: setTags ? undefined : item.removeTags ?? top.removeTags,
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

        const results: Array<Record<string, unknown>> = [];
        let updated = 0;
        for (const e of effective) {
          const workspaceId = e.workspaceId;
          if (!workspaceId) {
            results.push({ nodeId: e.nodeId, ok: false, error: 'Missing workspaceId (set it on the node or at the top level).' });
            continue;
          }
          const hasOp = e.setTags !== undefined || (e.addTags?.length ?? 0) > 0 || (e.removeTags?.length ?? 0) > 0;
          if (!hasOp) {
            results.push({ workspaceId, nodeId: e.nodeId, ok: false, error: 'No tag operation given (addTags / removeTags / setTags).' });
            continue;
          }

          const canvasNodes = await loadCanvasNodes(workspaceId);
          const canvasNode = canvasNodes.get(e.nodeId);
          const record = await readWorkspaceNode(workspaceId, e.nodeId);
          if (!canvasNode && !record) {
            results.push({ workspaceId, nodeId: e.nodeId, ok: false, error: 'Node not found in this workspace.' });
            continue;
          }

          const ops: TagOps = {
            addIds: toIds(e.addTags),
            removeKeys: toRemoveKeys(e.removeTags),
            setIds: e.setTags !== undefined ? toIds(e.setTags) : null,
          };
          const nextTags = computeNextTags(recordTags(record), ops, index);

          // Don't materialise an empty record just to write zero tags.
          if (!record && nextTags.length === 0) {
            results.push({ workspaceId, nodeId: e.nodeId, ok: true, created: false, tags: [] });
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
          updated += 1;
          results.push({ workspaceId, nodeId: e.nodeId, ok: true, created: !record, tags: nextTags });
        }

        return JSON.stringify({
          ok: results.every((r) => r.ok),
          total: results.length,
          updated,
          results,
        });
      },
    },
  };
}

// Re-exported for unit tests.
export const __testing = { computeNextTags, buildTagIndex, canonical };
