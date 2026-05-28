import { z } from 'zod';
import type { CanvasTool } from './types';
import { loadCanvas, saveCanvas } from './_shared/canvas-io';
import { broadcastUpdate } from './_shared/broadcast';

export function createGroupTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_add_to_group: {
      name: 'canvas_add_to_group',
      defer_loading: true,
      description:
        'Add one or more nodes to a group node\'s explicit child list (`data.childIds`). ' +
        'Use this to make grouping deterministic — frames rely on spatial bbox containment, but groups own their members explicitly via childIds. ' +
        'Targets that are already in the group are ignored (dedup). Cannot add the group to itself.',
      inputSchema: z.object({
        groupId: z.string().describe('The group node id. Must reference a node of type "group".'),
        nodeIds: z.array(z.string()).min(1).describe('Node ids to add to the group.'),
      }),
      execute: async (input) => {
        const groupId = input.groupId as string;
        const requested = (input.nodeIds as string[]).filter((id) => typeof id === 'string' && id);

        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        const group = canvas.nodes.find((n) => n.id === groupId);
        if (!group) return `Error: group not found: ${groupId}`;
        if (group.type !== 'group') {
          return `Error: node ${groupId} is type "${group.type}", not "group". Use canvas_update_node for frames; frame membership is spatial.`;
        }

        const validIds = new Set(canvas.nodes.map((n) => n.id));
        const missing = requested.filter((id) => !validIds.has(id));
        const selfRef = requested.includes(groupId);
        const candidates = requested.filter((id) => validIds.has(id) && id !== groupId);

        const existing: string[] = Array.isArray(group.data.childIds)
          ? (group.data.childIds as unknown[]).filter((v): v is string => typeof v === 'string')
          : [];
        const existingSet = new Set(existing);
        const added: string[] = [];
        for (const id of candidates) {
          if (existingSet.has(id)) continue;
          existingSet.add(id);
          added.push(id);
        }

        if (added.length === 0) {
          return JSON.stringify({
            ok: true,
            groupId,
            added: [],
            childIds: existing,
            note: 'No changes — all targets were already members (or invalid).',
            ...(missing.length ? { missing } : {}),
            ...(selfRef ? { selfRef: true } : {}),
          });
        }

        // Re-read so concurrent edits to OTHER fields of the group survive.
        const fresh = (await loadCanvas(workspaceId)) ?? canvas;
        const idx = fresh.nodes.findIndex((n) => n.id === groupId);
        if (idx === -1) return `Error: group ${groupId} was deleted concurrently; add aborted`;
        const freshGroup = fresh.nodes[idx];
        const freshExisting: string[] = Array.isArray(freshGroup.data.childIds)
          ? (freshGroup.data.childIds as unknown[]).filter((v): v is string => typeof v === 'string')
          : [];
        const merged = [...freshExisting];
        const mergedSet = new Set(freshExisting);
        for (const id of added) {
          if (mergedSet.has(id)) continue;
          mergedSet.add(id);
          merged.push(id);
        }
        freshGroup.data.childIds = merged;
        freshGroup.updatedAt = Date.now();

        await saveCanvas(workspaceId, fresh);
        broadcastUpdate(workspaceId, [groupId]);

        return JSON.stringify({
          ok: true,
          groupId,
          added,
          childIds: merged,
          ...(missing.length ? { missing } : {}),
          ...(selfRef ? { selfRef: true } : {}),
        });
      },
    },

    canvas_remove_from_group: {
      name: 'canvas_remove_from_group',
      defer_loading: true,
      description:
        'Remove one or more nodes from a group node\'s explicit child list (`data.childIds`). ' +
        'Targets not currently in the group are ignored. Does NOT delete the nodes themselves.',
      inputSchema: z.object({
        groupId: z.string().describe('The group node id.'),
        nodeIds: z.array(z.string()).min(1).describe('Node ids to remove from the group.'),
      }),
      execute: async (input) => {
        const groupId = input.groupId as string;
        const requested = new Set(
          (input.nodeIds as string[]).filter((id) => typeof id === 'string' && id),
        );

        const fresh = await loadCanvas(workspaceId);
        if (!fresh) return 'Error: workspace not found';

        const idx = fresh.nodes.findIndex((n) => n.id === groupId);
        if (idx === -1) return `Error: group not found: ${groupId}`;
        const group = fresh.nodes[idx];
        if (group.type !== 'group') {
          return `Error: node ${groupId} is type "${group.type}", not "group".`;
        }

        const existing: string[] = Array.isArray(group.data.childIds)
          ? (group.data.childIds as unknown[]).filter((v): v is string => typeof v === 'string')
          : [];
        const next = existing.filter((id) => !requested.has(id));
        const removed = existing.filter((id) => requested.has(id));

        if (removed.length === 0) {
          return JSON.stringify({
            ok: true,
            groupId,
            removed: [],
            childIds: existing,
            note: 'No changes — none of the targets were group members.',
          });
        }

        group.data.childIds = next;
        group.updatedAt = Date.now();

        await saveCanvas(workspaceId, fresh);
        broadcastUpdate(workspaceId, [groupId]);

        return JSON.stringify({
          ok: true,
          groupId,
          removed,
          childIds: next,
        });
      },
    },
  };
}
