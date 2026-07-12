/**
 * Cross-workspace knowledge tools.
 *
 * These answer "what does my whole Pulse Canvas system look like" questions —
 * which workspaces exist, which tags are defined, and which nodes carry (or
 * lack) tags — across every workspace at once. They exist so the global chat
 * (which has no current workspace) can read local canvas data directly instead
 * of falling back to an unrelated external MCP server, and so a tagging skill
 * can audit coverage / find candidates for a tag.
 *
 * Unlike `workspace_node_list` / `canvas_search_nodes` (single-workspace, and
 * `defer_loading`), these are eager: they must be visible in the immediate tool
 * list so the model reaches for them first. They take an OPTIONAL `workspaceId`
 * and default to scanning every workspace.
 */

import { z } from 'zod';
import { listWorkspaces, type WorkspaceInfo } from '../../canvas/workspaces';
import { listWorkspaceNodes, type WorkspaceNodeRecord } from '../../canvas/nodes/store';
import { readKnowledgeTags, type KnowledgeTagDefinition } from '../../canvas/nodes/tags';
import { loadCanvas } from './_shared/canvas-io';
import type { CanvasNode, CanvasTool } from './types';
import { readNodeDetail } from '../context-builder';
import {
  analyzeImagesWithGemini,
  analyzeImagesWithOpenAI,
  resolveImageInputs,
} from './_shared/vision-clients';

// ─── Shared helpers ────────────────────────────────────────────────

/** String tags stored on a knowledge record (`properties.tags`). */
function recordTags(record: WorkspaceNodeRecord | undefined): string[] {
  const raw = record?.properties?.tags;
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
}

/**
 * Map every lowercased tag token (id OR name) to its canonical tag id. Stored
 * `properties.tags` may hold either ids (renderer tag picker) or names (agent
 * upserts / @-mentions), so both must resolve to the same definition.
 */
function buildTagIndex(tags: KnowledgeTagDefinition[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const tag of tags) {
    index.set(tag.id.toLowerCase(), tag.id);
    index.set(tag.name.toLowerCase(), tag.id);
  }
  return index;
}

/** Short, single-line snippet from a knowledge summary or canvas node body. */
function snippetFor(node: CanvasNode | undefined, record: WorkspaceNodeRecord | undefined): string {
  const summary = record?.properties?.summary;
  const candidates: Array<string | undefined> = [
    typeof summary === 'string' ? summary : undefined,
  ];
  for (const key of ['content', 'url', 'filePath']) {
    const value = record?.data?.[key];
    if (typeof value === 'string') candidates.push(value);
  }
  const data = node?.data ?? {};
  for (const key of ['content', 'label', 'url', 'filePath', 'prompt']) {
    const v = data[key];
    if (typeof v === 'string') candidates.push(v);
  }
  const first = candidates.find((c) => c && c.trim().length > 0) ?? '';
  const normalized = first.replace(/\s+/g, ' ').trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

/** Lowercased haystack of a canvas node's text fields, for `query` matching. */
function nodeHaystack(node: CanvasNode): string {
  const fields: string[] = [node.title ?? '', node.type ?? ''];
  const data = node.data ?? {};
  for (const key of ['content', 'label', 'url', 'filePath', 'prompt', 'html']) {
    const v = data[key];
    if (typeof v === 'string') fields.push(v);
  }
  return fields.join('\n').toLowerCase();
}

function recordHaystack(record: WorkspaceNodeRecord): string {
  return [
    record.title ?? '',
    record.type,
    JSON.stringify(record.data ?? {}),
    JSON.stringify(record.properties ?? {}),
  ].join('\n').toLowerCase();
}

function mediaPathFor(node: CanvasNode | undefined, record: WorkspaceNodeRecord | undefined): string | undefined {
  const candidates = [record?.data?.filePath, node?.data?.filePath];
  return candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

/** Resolve the workspaces to scan: one (if `workspaceId` given) or all. */
async function resolveTargets(workspaceId?: string): Promise<WorkspaceInfo[]> {
  const { workspaces } = await listWorkspaces();
  if (!workspaceId) return workspaces;
  const found = workspaces.find((w) => w.id === workspaceId);
  // Allow an id that is on disk but missing from the manifest.
  return [found ?? { id: workspaceId, name: workspaceId }];
}

// ─── Tools ─────────────────────────────────────────────────────────

export function createKnowledgeTools(): Record<string, CanvasTool> {
  return {
    knowledge_search_nodes: {
      name: 'knowledge_search_nodes',
      description:
        'Search the user\'s Nodes knowledge library without requiring a workspace. ' +
        'Use this when the user has not already selected or @-mentioned an exact node. ' +
        'Searches titles, content, metadata, tags, and records that are no longer placed on a canvas. ' +
        'Returns compact matches; call knowledge_read_node with the exact id before answering about a node.',
      inputSchema: z.object({
        query: z.string().optional().describe('Words to match against title, content, metadata, and tags.'),
        types: z.array(z.string()).optional().describe('Optional node types to include.'),
        tags: z.array(z.string()).optional().describe('Optional tags. A node must match every supplied tag.'),
        limit: z.number().int().positive().max(100).optional().describe('Maximum results. Default 20.'),
      }),
      execute: async (input) => {
        const query = typeof input?.query === 'string' ? input.query.trim().toLowerCase() : '';
        const types = new Set((input?.types as string[] | undefined)?.map((value) => value.toLowerCase()) ?? []);
        const wantedTags = (input?.tags as string[] | undefined)?.map((value) => value.toLowerCase()) ?? [];
        const limit = (input?.limit as number | undefined) ?? 20;
        const targets = await resolveTargets();
        const matches: Array<Record<string, unknown>> = [];

        for (const workspace of targets) {
          const canvas = await loadCanvas(workspace.id);
          const canvasById = new Map((canvas?.nodes ?? []).map((node) => [node.id, node] as const));
          const records = await listWorkspaceNodes(workspace.id);
          const recordsById = new Map(records.map((record) => [record.id, record] as const));
          const ids = new Set([...canvasById.keys(), ...recordsById.keys()]);

          for (const id of ids) {
            const node = canvasById.get(id);
            const record = recordsById.get(id);
            const type = node?.type ?? record?.type ?? 'unknown';
            const tags = recordTags(record);
            if (types.size > 0 && !types.has(type.toLowerCase())) continue;
            if (wantedTags.length > 0) {
              const available = new Set(tags.map((tag) => tag.toLowerCase()));
              if (!wantedTags.every((tag) => available.has(tag))) continue;
            }
            const haystack = [node ? nodeHaystack(node) : '', record ? recordHaystack(record) : ''].join('\n');
            if (query && !haystack.includes(query)) continue;
            if (matches.length >= limit) continue;
            const mediaPath = mediaPathFor(node, record);
            matches.push({
              id,
              title: record?.title ?? node?.title ?? id,
              type,
              tags,
              summary: snippetFor(node, record),
              onCanvas: Boolean(node),
              ...(mediaPath ? { mediaPath } : {}),
              // Internal locator for follow-up mutation tools. The user does
              // not need to choose or understand a workspace.
              workspaceId: workspace.id,
            });
          }
        }

        return JSON.stringify({ ok: true, returned: matches.length, nodes: matches });
      },
    },

    knowledge_read_node: {
      name: 'knowledge_read_node',
      description:
        'Read one exact node from the Nodes knowledge library without requiring a workspace. ' +
        'Use this directly for a selected or @-mentioned node; do not search again first. ' +
        'Reads both the knowledge record and its canvas content when available, including off-canvas records and image file paths. ' +
        'The returned workspaceId identifies the node\'s owning workspace.',
      inputSchema: z.object({
        nodeId: z.string().min(1).describe('Exact node id from selected context or knowledge_search_nodes.'),
      }),
      execute: async (input) => {
        const nodeId = input.nodeId as string;
        const targets = await resolveTargets();
        const found: Array<{ workspace: WorkspaceInfo; node?: CanvasNode; record?: WorkspaceNodeRecord }> = [];
        for (const workspace of targets) {
          const canvas = await loadCanvas(workspace.id);
          const node = canvas?.nodes.find((candidate) => candidate.id === nodeId);
          const record = (await listWorkspaceNodes(workspace.id)).find((candidate) => candidate.id === nodeId);
          if (node || record) found.push({ workspace, node, record });
        }
        if (found.length === 0) return JSON.stringify({ ok: false, error: 'Node not found.', nodeId });
        if (found.length > 1) {
          return JSON.stringify({
            ok: false,
            error: 'Node id is ambiguous. Use knowledge_search_nodes to choose the exact result.',
            nodeId,
            matches: found.map(({ workspace, node, record }) => ({
              workspaceId: workspace.id,
              title: record?.title ?? node?.title ?? nodeId,
            })),
          });
        }
        const [{ workspace, node, record }] = found;
        const mediaPath = mediaPathFor(node, record);
        const canvasDetail = node ? await readNodeDetail(workspace.id, nodeId) : null;
        return JSON.stringify({
          ok: true,
          node: {
            id: nodeId,
            title: record?.title ?? node?.title ?? nodeId,
            type: node?.type ?? record?.type ?? 'unknown',
            workspaceId: workspace.id,
            onCanvas: Boolean(node),
            tags: recordTags(record),
            data: { ...(node?.data ?? {}), ...(record?.data ?? {}) },
            ...(canvasDetail ? { content: canvasDetail } : {}),
            properties: record?.properties ?? {},
            links: record?.links ?? [],
            ...(mediaPath ? { mediaPath } : {}),
          },
        });
      },
    },

    knowledge_analyze_image: {
      name: 'knowledge_analyze_image',
      description:
        'Analyze the pixels of an image node from the Nodes knowledge library without requiring a workspace. ' +
        'Use this for OCR, visual explanation, or questions about what an exact selected image contains. ' +
        'It resolves off-canvas image records through their stored media path; do not take a canvas screenshot instead.',
      inputSchema: z.object({
        nodeId: z.string().min(1).describe('Exact image node id from selected context or knowledge_search_nodes.'),
        prompt: z.string().optional().describe('Question or instruction for the vision model.'),
        provider: z.enum(['openai', 'gpt', 'gemini']).optional().describe('Vision provider. Defaults to OpenAI/GPT.'),
        model: z.string().optional().describe('Optional vision model override.'),
      }),
      execute: async (input) => {
        const nodeId = input.nodeId as string;
        const targets = await resolveTargets();
        const paths: string[] = [];
        for (const workspace of targets) {
          const canvas = await loadCanvas(workspace.id);
          const node = canvas?.nodes.find((candidate) => candidate.id === nodeId);
          const record = (await listWorkspaceNodes(workspace.id)).find((candidate) => candidate.id === nodeId);
          const path = mediaPathFor(node, record);
          if (path) paths.push(path);
        }
        const uniquePaths = Array.from(new Set(paths));
        if (uniquePaths.length === 0) return JSON.stringify({ ok: false, error: 'Image node or media path not found.', nodeId });
        if (uniquePaths.length > 1) return JSON.stringify({ ok: false, error: 'Image node id is ambiguous.', nodeId });
        const images = await resolveImageInputs({
          nodes: [],
          edges: [],
          transform: { x: 0, y: 0, scale: 1 },
          savedAt: '',
        }, { imagePaths: uniquePaths });
        const prompt = (input.prompt as string | undefined)?.trim()
          || 'Describe the image, OCR visible text, and extract the most useful facts.';
        const provider = input.provider === 'gemini' ? 'gemini' : 'openai';
        const result = provider === 'gemini'
          ? await analyzeImagesWithGemini({ prompt, images, model: input.model as string | undefined })
          : await analyzeImagesWithOpenAI({ prompt, images, model: input.model as string | undefined });
        return JSON.stringify({ ok: true, nodeId, ...result, imagePath: uniquePaths[0] });
      },
    },

    canvas_list_workspaces: {
      name: 'canvas_list_workspaces',
      description:
        'List every workspace (canvas) in this local Pulse Canvas system: id, name, node count, and tag coverage (how many nodes are tagged vs. untagged). ' +
        'Use this FIRST in global chat to discover which workspaces exist and to pick a `workspaceId` — there is no current/default workspace in global chat, so prefer this over asking the user. ' +
        'Reads the local on-disk store; never use an external MCP server to list local workspaces.',
      inputSchema: z.object({
        includeTagStats: z
          .boolean()
          .optional()
          .describe('Include per-workspace tagged/untagged node counts (default true). Set false for a faster id+name listing.'),
      }),
      execute: async (input) => {
        const includeStats = input?.includeTagStats !== false;
        const { activeId, workspaces } = await listWorkspaces();
        const rows = [] as Array<Record<string, unknown>>;
        for (const ws of workspaces) {
          const canvas = await loadCanvas(ws.id);
          const canvasNodeCount = canvas?.nodes.length ?? 0;
          const row: Record<string, unknown> = {
            workspaceId: ws.id,
            name: ws.name,
            canvasNodeCount,
          };
          if (includeStats) {
            const records = await listWorkspaceNodes(ws.id);
            const recordById = new Map(records.map((r) => [r.id, r] as const));
            let tagged = 0;
            for (const node of canvas?.nodes ?? []) {
              if (recordTags(recordById.get(node.id)).length > 0) tagged += 1;
            }
            row.taggedNodeCount = tagged;
            row.untaggedNodeCount = Math.max(0, canvasNodeCount - tagged);
            row.knowledgeNodeCount = records.length;
          }
          rows.push(row);
        }
        return JSON.stringify({
          ok: true,
          total: rows.length,
          activeWorkspaceId: activeId,
          workspaces: rows,
        });
      },
    },

    canvas_list_tags: {
      name: 'canvas_list_tags',
      description:
        'List all knowledge tags defined in this local Pulse Canvas system. Tags are shared across every workspace. ' +
        'This is the canonical answer to "what tags do I have / 我有哪些标签". With usage stats it also reports how many nodes use each tag and how many knowledge nodes are still untagged. ' +
        'Always use this for local canvas tags — do NOT call an external/3rd-party MCP server (e.g. a separate mind/notes tool) to list them.',
      inputSchema: z.object({
        includeUsage: z
          .boolean()
          .optional()
          .describe('Count how many nodes use each tag across all workspaces (default true). Set false to skip the scan and just return tag definitions.'),
      }),
      execute: async (input) => {
        const includeUsage = input?.includeUsage !== false;
        const tags = await readKnowledgeTags();

        if (!includeUsage) {
          return JSON.stringify({
            ok: true,
            total: tags.length,
            tags: tags.map((t) => ({ id: t.id, name: t.name, description: t.description })),
          });
        }

        const tagIndex = buildTagIndex(tags);
        const usage = new Map<string, number>();
        let totalKnowledgeNodes = 0;
        let untaggedKnowledgeNodes = 0;
        const { workspaces } = await listWorkspaces();
        for (const ws of workspaces) {
          for (const record of await listWorkspaceNodes(ws.id)) {
            totalKnowledgeNodes += 1;
            const tokens = recordTags(record);
            if (tokens.length === 0) {
              untaggedKnowledgeNodes += 1;
              continue;
            }
            const counted = new Set<string>();
            for (const token of tokens) {
              const canonical = tagIndex.get(token.toLowerCase());
              if (canonical && !counted.has(canonical)) {
                counted.add(canonical);
                usage.set(canonical, (usage.get(canonical) ?? 0) + 1);
              }
            }
          }
        }

        return JSON.stringify({
          ok: true,
          total: tags.length,
          scannedWorkspaces: workspaces.length,
          totalKnowledgeNodes,
          untaggedKnowledgeNodes,
          tags: tags.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            nodeCount: usage.get(t.id) ?? 0,
          })),
        });
      },
    },

    canvas_list_nodes: {
      name: 'canvas_list_nodes',
      description:
        'List canvas nodes across the whole system (or one workspace) together with each node\'s knowledge tags. ' +
        'The cross-workspace, tag-aware node index — use it to audit tag coverage ("which nodes have no tags / 哪些节点没打标签") or to find candidates for a tag. ' +
        'Filters: `workspaceId` (one workspace; omit = every workspace), `tag` (only nodes carrying this tag, by name or id), `untaggedOnly` (only nodes with zero tags), `query` (case-insensitive substring over title + content). ' +
        'Returns a compact list; use `canvas_read_node` for a single node\'s full content. For single-workspace metadata atoms use `workspace_node_list`.',
      inputSchema: z.object({
        workspaceId: z.string().optional().describe('Restrict to one workspace. Omit to scan every workspace.'),
        tag: z.string().optional().describe('Only nodes carrying this tag (matched by tag name or id, case-insensitive).'),
        untaggedOnly: z.boolean().optional().describe('Only return nodes that currently have no tags.'),
        query: z.string().optional().describe('Case-insensitive substring matched against node title and content.'),
        limit: z.number().int().positive().max(500).optional().describe('Max nodes to return. Default 100.'),
        includeSummary: z.boolean().optional().describe('Include a short content snippet per node (default true).'),
      }),
      execute: async (input) => {
        const targets = await resolveTargets(input?.workspaceId as string | undefined);
        const untaggedOnly = input?.untaggedOnly === true;
        const includeSummary = input?.includeSummary !== false;
        const query = typeof input?.query === 'string' ? input.query.trim().toLowerCase() : '';
        const limit = (input?.limit as number | undefined) ?? 100;

        // Resolve a tag filter into the set of accepted lowercased tokens
        // (its id + name), so a stored id or name both match.
        let tagAccept: Set<string> | null = null;
        if (typeof input?.tag === 'string' && input.tag.trim()) {
          const token = input.tag.trim().toLowerCase();
          tagAccept = new Set<string>([token]);
          for (const t of await readKnowledgeTags()) {
            if (t.id.toLowerCase() === token || t.name.toLowerCase() === token) {
              tagAccept.add(t.id.toLowerCase());
              tagAccept.add(t.name.toLowerCase());
            }
          }
        }

        const nodes: Array<Record<string, unknown>> = [];
        let total = 0;
        let truncated = false;

        for (const ws of targets) {
          const canvas = await loadCanvas(ws.id);
          if (!canvas) continue;
          const records = await listWorkspaceNodes(ws.id);
          const recordById = new Map(records.map((r) => [r.id, r] as const));

          for (const node of canvas.nodes) {
            const record = recordById.get(node.id);
            const tags = recordTags(record);

            if (untaggedOnly && tags.length > 0) continue;
            if (tagAccept) {
              const lower = new Set(tags.map((t) => t.toLowerCase()));
              let matched = false;
              for (const accepted of tagAccept) {
                if (lower.has(accepted)) {
                  matched = true;
                  break;
                }
              }
              if (!matched) continue;
            }
            if (query && !nodeHaystack(node).includes(query)) continue;

            total += 1;
            if (nodes.length >= limit) {
              truncated = true;
              continue;
            }
            nodes.push({
              workspaceId: ws.id,
              workspaceName: ws.name,
              id: node.id,
              type: node.type,
              title: node.title ?? '',
              tags,
              ...(includeSummary ? { summary: snippetFor(node, record) } : {}),
            });
          }
        }

        return JSON.stringify({
          ok: true,
          total,
          returned: nodes.length,
          truncated,
          nodes,
        });
      },
    },
  };
}
