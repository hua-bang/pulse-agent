import { z } from 'zod';
import {
  listWorkspaceNodes,
  type WorkspaceNodeRecord,
} from '../../canvas/nodes/store';
import { readKnowledgeTags } from '../../canvas/nodes/tags';
import type { CanvasNode, CanvasTool } from './types';
import { loadCanvas } from './_shared/canvas-io';

export function createSearchTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_search_nodes: {
      name: 'canvas_search_nodes',
      description:
        'Search canvas nodes by query, type, or workspace-node tag. ' +
        'Returns a compact list (id, type, title, snippet) so you can avoid pulling the whole canvas summary when you only need a few matches. ' +
        'Use this before `canvas_read_node` to narrow down which nodes to read in detail.',
      inputSchema: z.object({
        query: z.string().optional().describe(
          'Case-insensitive substring matched against node title, label, content, url, and filePath.',
        ),
        type: z.union([
          z.enum(['file', 'terminal', 'frame', 'group', 'agent', 'text', 'iframe', 'image', 'shape', 'mindmap']),
          z.array(z.enum(['file', 'terminal', 'frame', 'group', 'agent', 'text', 'iframe', 'image', 'shape', 'mindmap'])),
        ]).optional().describe('Restrict to one or more node types.'),
        tag: z.union([z.string(), z.array(z.string())]).optional().describe(
          'Filter by workspace-node tag(s), given as tag NAME or id. A node matches when its workspace-node record has ALL provided tags in `properties.tags` ' +
          '(stored as tag ids/slugs; names are resolved automatically, case-insensitively). ' +
          'Tags live in the knowledge layer (`workspace-node-store`), not on the canvas node itself.',
        ),
        limit: z.number().int().positive().max(200).optional().describe('Max results to return. Default 30.'),
        workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace.'),
      }),
      execute: async (input) => {
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        const canvas = await loadCanvas(targetWorkspaceId);
        if (!canvas) return `Error: workspace not found: ${targetWorkspaceId}`;

        const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
        const typeFilter = (() => {
          if (!input.type) return null;
          const arr = Array.isArray(input.type) ? input.type : [input.type];
          return new Set(arr as string[]);
        })();
        const tagFilter = (() => {
          if (!input.tag) return null;
          const arr: unknown[] = Array.isArray(input.tag) ? input.tag : [input.tag];
          const cleaned = arr
            .filter((t: unknown): t is string => typeof t === 'string')
            .map((t: string) => t.trim())
            .filter(Boolean);
          return cleaned.length ? cleaned : null;
        })();
        const limit = (input.limit as number | undefined) ?? 30;

        const wsNodeById = new Map<string, WorkspaceNodeRecord>();
        // For each requested tag token, the set of stored values that count as a
        // match. Stored tags are ids (slugs); a token may be a name, so resolve
        // names → ids via the global tag store (case-insensitive).
        let tagAcceptSets: Set<string>[] | null = null;
        if (tagFilter) {
          const records = await listWorkspaceNodes(targetWorkspaceId);
          for (const record of records) wsNodeById.set(record.id, record);

          const idsByName = new Map<string, string[]>();
          for (const tg of await readKnowledgeTags()) {
            const key = tg.name.trim().toLowerCase();
            const arr = idsByName.get(key) ?? [];
            arr.push(tg.id);
            idsByName.set(key, arr);
          }
          tagAcceptSets = tagFilter.map((token) => {
            const accept = new Set<string>([token]);
            for (const id of idsByName.get(token.toLowerCase()) ?? []) accept.add(id);
            return accept;
          });
        }

        const matchHaystacks = (node: CanvasNode): string[] => {
          const fields: string[] = [node.title ?? '', node.type ?? ''];
          const data = node.data ?? {};
          for (const key of ['content', 'label', 'url', 'filePath', 'cwd', 'prompt', 'html']) {
            const v = data[key];
            if (typeof v === 'string') fields.push(v);
          }
          return fields;
        };

        const snippetFor = (node: CanvasNode): string => {
          const data = node.data ?? {};
          const candidates: Array<string | undefined> = [
            typeof data.content === 'string' ? (data.content as string) : undefined,
            typeof data.label === 'string' ? (data.label as string) : undefined,
            typeof data.url === 'string' ? (data.url as string) : undefined,
            typeof data.filePath === 'string' ? (data.filePath as string) : undefined,
          ];
          const first = candidates.find((c) => c && c.trim().length > 0) ?? '';
          const normalized = first.replace(/\s+/g, ' ').trim();
          return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
        };

        const matches: Array<{
          id: string;
          type: string;
          title: string;
          snippet: string;
          x: number;
          y: number;
          tags?: string[];
        }> = [];

        for (const node of canvas.nodes) {
          if (typeFilter && !typeFilter.has(node.type)) continue;

          if (tagAcceptSets) {
            const record = wsNodeById.get(node.id);
            const rawTags: unknown[] = Array.isArray(record?.properties?.tags)
              ? (record!.properties!.tags as unknown[])
              : [];
            const tagSet = new Set(
              rawTags.filter((t: unknown): t is string => typeof t === 'string'),
            );
            const hasAll = tagAcceptSets.every((accept) => {
              for (const id of accept) if (tagSet.has(id)) return true;
              return false;
            });
            if (!hasAll) continue;
          }

          if (query) {
            const hay = matchHaystacks(node).join('\n').toLowerCase();
            if (!hay.includes(query)) continue;
          }

          const record = wsNodeById.get(node.id);
          const tags = Array.isArray(record?.properties?.tags)
            ? (record!.properties!.tags as string[]).filter((t): t is string => typeof t === 'string')
            : undefined;

          matches.push({
            id: node.id,
            type: node.type,
            title: node.title ?? '',
            snippet: snippetFor(node),
            x: node.x,
            y: node.y,
            ...(tags && tags.length ? { tags } : {}),
          });
          if (matches.length >= limit) break;
        }

        return JSON.stringify({
          ok: true,
          workspaceId: targetWorkspaceId,
          total: matches.length,
          truncated: matches.length >= limit,
          matches,
        });
      },
    },
  };
}
