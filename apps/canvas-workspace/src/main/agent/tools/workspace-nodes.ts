import { z } from 'zod';
import {
  listWorkspaceNodes,
  readWorkspaceNode,
  writeWorkspaceNode,
  WORKSPACE_NODE_SCHEMA_VERSION,
  type WorkspaceNodeRecord,
  type WorkspaceNodeLink,
  type WorkspaceNodePropertyValue,
} from '../../canvas/nodes/store';
import { readKnowledgeTags, upsertKnowledgeTag } from '../../canvas/nodes/tags';
import type { CanvasTool } from './types';

export function createWorkspaceNodeTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    workspace_node_list: {
      name: 'workspace_node_list',
      defer_loading: true,
      description:
        'List workspace-node knowledge atoms — the separate metadata layer that stores `properties` (tags, summary, kind, sourceUrl...) and `links` (relations between nodes) alongside the visual canvas. ' +
        'A workspace-node has the SAME id as the canvas node it annotates (when one exists), but they are stored separately. ' +
        'Use this to surface what knowledge metadata already exists before reading or editing.',
      inputSchema: z.object({
        workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace.'),
      }),
      execute: async (input) => {
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        const records = await listWorkspaceNodes(targetWorkspaceId);
        const tags = await readKnowledgeTags();
        const nodes = records.map((record) => {
          const tagsArr = Array.isArray(record.properties?.tags)
            ? (record.properties!.tags as unknown[]).filter((t): t is string => typeof t === 'string')
            : [];
          return {
            id: record.id,
            type: record.type,
            title: record.title,
            tags: tagsArr,
            linkCount: Array.isArray(record.links) ? record.links.length : 0,
            propertyKeys: record.properties ? Object.keys(record.properties) : [],
            updatedAt: record.updatedAt,
          };
        });
        return JSON.stringify({
          ok: true,
          workspaceId: targetWorkspaceId,
          total: nodes.length,
          nodes,
          knownTags: tags.map((t) => ({ id: t.id, name: t.name, description: t.description })),
        });
      },
    },

    workspace_node_get: {
      name: 'workspace_node_get',
      defer_loading: true,
      description:
        'Read the full workspace-node metadata record for a given node id (properties, links, data, tags). ' +
        'Returns null when no metadata atom exists yet — use `workspace_node_upsert` to create one.',
      inputSchema: z.object({
        nodeId: z.string().describe('The node id (matches the canvas node id when annotating one).'),
        workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace.'),
      }),
      execute: async (input) => {
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        const nodeId = input.nodeId as string;
        const record = await readWorkspaceNode(targetWorkspaceId, nodeId);
        return JSON.stringify({ ok: true, workspaceId: targetWorkspaceId, nodeId, record });
      },
    },

    workspace_node_upsert: {
      name: 'workspace_node_upsert',
      defer_loading: true,
      description:
        'Create or merge-update a workspace-node knowledge atom (separate from the canvas layout). ' +
        'Use this to attach `tags`, `properties` (kind, summary, sourceUrl, custom values), and `links` (typed relations to other nodes) to a node id. ' +
        'When the record already exists, the patch is merged: `properties` are shallow-merged, `links` REPLACES the existing array when provided, and `tags` REPLACES `properties.tags` when provided. ' +
        'Tags referenced here are auto-registered as `KnowledgeTagDefinition`s if they don\'t already exist.',
      inputSchema: z.object({
        nodeId: z.string().describe('Node id. Use the canvas node id when annotating an existing canvas node.'),
        type: z.string().optional().describe('Node type. Defaults to "note" for new records; ignored for existing records unless explicitly set.'),
        title: z.string().optional().describe('Optional display title.'),
        tags: z.array(z.string()).optional().describe('Tag names. Replaces `properties.tags` entirely when provided. New names are auto-registered in the global tag store.'),
        properties: z.record(z.string(), z.unknown()).optional().describe(
          'Properties to merge into `properties`. Values may be string | number | boolean | null | string[] | number[] | { type: "date"|"url"|"file"|"node"|"workspace-node", ... }. ' +
          'Keys not provided are left untouched. Pass `null` for a key to clear it.',
        ),
        links: z.array(z.object({
          relation: z.string().describe('Relation name, e.g. "references", "implements", "depends-on".'),
          targetNodeId: z.string().describe('The target node id.'),
          targetWorkspaceId: z.string().optional().describe('Cross-workspace target. Omit for same-workspace links.'),
          title: z.string().optional(),
        })).optional().describe('When provided, REPLACES the full `links` array. Omit to keep existing links.'),
        data: z.record(z.string(), z.unknown()).optional().describe('Optional data payload (free-form). Shallow-merged when patching.'),
        workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace.'),
      }),
      execute: async (input) => {
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        const nodeId = input.nodeId as string;

        const existing = await readWorkspaceNode(targetWorkspaceId, nodeId);
        const now = Date.now();

        const patchProperties = input.properties as Record<string, WorkspaceNodePropertyValue | null> | undefined;
        const mergedProperties: Record<string, WorkspaceNodePropertyValue> = { ...(existing?.properties ?? {}) };
        if (patchProperties) {
          for (const [k, v] of Object.entries(patchProperties)) {
            if (v === null || v === undefined) {
              delete mergedProperties[k];
            } else {
              mergedProperties[k] = v as WorkspaceNodePropertyValue;
            }
          }
        }
        if (Array.isArray(input.tags)) {
          const cleanTags = (input.tags as unknown[])
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.trim())
            .filter(Boolean);
          const dedup = Array.from(new Set(cleanTags));
          mergedProperties.tags = dedup;
          // Auto-register tags so the renderer's tag picker shows them.
          for (const name of dedup) {
            try {
              await upsertKnowledgeTag({ name });
            } catch {
              // tag-store rejects unsafe ids; skip silently rather than fail the whole upsert.
            }
          }
        }

        const nextLinks: WorkspaceNodeLink[] | undefined = Array.isArray(input.links)
          ? (input.links as Array<{
              relation: string;
              targetNodeId: string;
              targetWorkspaceId?: string;
              title?: string;
            }>).map((l) => ({
              relation: l.relation,
              target: l.targetWorkspaceId
                ? { workspaceId: l.targetWorkspaceId, nodeId: l.targetNodeId }
                : { nodeId: l.targetNodeId },
              ...(l.title ? { title: l.title } : {}),
            }))
          : existing?.links;

        const mergedData: Record<string, unknown> = {
          ...(existing?.data ?? {}),
          ...(input.data ? (input.data as Record<string, unknown>) : {}),
        };

        const next: WorkspaceNodeRecord = {
          schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
          id: nodeId,
          type: (input.type as string | undefined) ?? existing?.type ?? 'note',
          ...(input.title !== undefined ? { title: input.title as string } : existing?.title !== undefined ? { title: existing.title } : {}),
          data: mergedData,
          ...(Object.keys(mergedProperties).length ? { properties: mergedProperties } : {}),
          ...(nextLinks && nextLinks.length ? { links: nextLinks } : {}),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };

        await writeWorkspaceNode(targetWorkspaceId, next);
        return JSON.stringify({
          ok: true,
          workspaceId: targetWorkspaceId,
          nodeId,
          created: !existing,
          record: next,
        });
      },
    },
  };
}
