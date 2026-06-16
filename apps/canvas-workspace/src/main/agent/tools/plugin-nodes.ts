import { z } from 'zod';
import type { CanvasNode, CanvasTool } from './types';
import { loadCanvas, saveCanvas } from './_shared/canvas-io';
import { broadcastUpdate } from './_shared/broadcast';
import {
  actionPublicResult,
  applyPluginNodePatch,
  getPluginNodeIdentity,
  isRecord,
  patchFromActionResult,
  patchFromWriteResult,
  readPluginNodeCapability,
  resolvePluginNodeCapability,
} from '../plugin-node-capabilities';
import type { CanvasNode as SharedCanvasNode } from '../../../shared/canvas';
import type { PluginNodeWriteInput } from '../../../plugins/types';

function targetWorkspace(input: { workspaceId?: unknown }, fallback: string): string {
  return typeof input.workspaceId === 'string' && input.workspaceId.trim()
    ? input.workspaceId
    : fallback;
}

function findNode(nodes: CanvasNode[], nodeId: string): CanvasNode | null {
  return nodes.find((node) => node.id === nodeId) ?? null;
}

function availableActions(node: CanvasNode): string[] {
  const resolved = resolvePluginNodeCapability(node);
  if (!resolved?.entry.capabilities.actions) return [];
  return Object.keys(resolved.entry.capabilities.actions).sort();
}

function writeInputFromToolInput(input: {
  title?: unknown;
  data?: unknown;
  payload?: unknown;
}): PluginNodeWriteInput {
  return {
    title: typeof input.title === 'string' ? input.title : undefined,
    data: isRecord(input.data) ? input.data : undefined,
    payload: isRecord(input.payload) ? input.payload : undefined,
  };
}

function hasWritePatch(input: PluginNodeWriteInput): boolean {
  return (
    input.title !== undefined ||
    input.data !== undefined ||
    input.payload !== undefined
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createPluginNodeTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_plugin_node_read: {
      name: 'canvas_plugin_node_read',
      description:
        'Read a custom plugin node through its registered semantic read capability. ' +
        'Use this for type="plugin" nodes when you need plugin-owned state in a structured form. ' +
        'For ordinary reads, canvas_read_node also delegates to this capability automatically.',
      inputSchema: z.object({
        nodeId: z.string().describe('The plugin node id to read.'),
        workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace.'),
      }),
      execute: async (input) => {
        const targetWorkspaceId = targetWorkspace(input, workspaceId);
        const nodeId = input.nodeId as string;
        const canvas = await loadCanvas(targetWorkspaceId);
        if (!canvas) return `Error: workspace not found: ${targetWorkspaceId}`;

        const node = findNode(canvas.nodes, nodeId);
        if (!node) return `Error: node not found: ${nodeId}`;
        const identity = getPluginNodeIdentity(node);
        if (!identity) return `Error: node is not a valid plugin node: ${nodeId}`;

        try {
          const read = await readPluginNodeCapability(targetWorkspaceId, node);
          if (!read) {
            return `Error: plugin node has no registered read capability: ${identity.pluginId}/${identity.nodeType}`;
          }
          return JSON.stringify({
            ok: true,
            nodeId,
            pluginId: read.pluginId,
            nodeType: read.nodeType,
            capabilities: read.capabilities,
            availableActions: availableActions(node),
            content: read.content,
            result: read.result,
          }, null, 2);
        } catch (err) {
          return `Error: plugin node read failed: ${errorMessage(err)}`;
        }
      },
    },

    canvas_plugin_node_write: {
      name: 'canvas_plugin_node_write',
      description:
        'Write to a custom plugin node through its registered write capability. ' +
        'Patch `payload` for plugin-owned JSON state, `data` for top-level plugin node data, or `title` for the canvas shell title. ' +
        'Use this only for type="plugin" nodes that list the write capability.',
      inputSchema: z.object({
        nodeId: z.string().describe('The plugin node id to update.'),
        title: z.string().optional().describe('Optional new canvas shell title.'),
        payload: z.record(z.string(), z.unknown()).optional().describe('Patch for node.data.payload.'),
        data: z.record(z.string(), z.unknown()).optional().describe('Patch for node.data. Prefer payload for plugin-owned state.'),
        workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace.'),
      }),
      execute: async (input) => {
        const targetWorkspaceId = targetWorkspace(input, workspaceId);
        const nodeId = input.nodeId as string;
        const writeInput = writeInputFromToolInput(input);
        if (!hasWritePatch(writeInput)) {
          return 'Error: provide at least one of title, payload, or data to write.';
        }

        const canvas = await loadCanvas(targetWorkspaceId);
        if (!canvas) return `Error: workspace not found: ${targetWorkspaceId}`;

        const node = findNode(canvas.nodes, nodeId);
        if (!node) return `Error: node not found: ${nodeId}`;
        const resolved = resolvePluginNodeCapability(node);
        const identity = getPluginNodeIdentity(node);
        if (!identity) return `Error: node is not a valid plugin node: ${nodeId}`;
        if (!resolved || !resolved.entry.capabilities.write) {
          return `Error: plugin node has no registered write capability: ${identity.pluginId}/${identity.nodeType}`;
        }

        try {
          const result = await resolved.entry.capabilities.write({
            workspaceId: targetWorkspaceId,
            node: node as unknown as SharedCanvasNode,
          }, writeInput);
          const patch = patchFromWriteResult(result, writeInput);
          const changed = applyPluginNodePatch(node, patch);
          if (changed) {
            await saveCanvas(targetWorkspaceId, canvas);
            broadcastUpdate(targetWorkspaceId, [nodeId]);
          }
          return JSON.stringify({
            ok: true,
            nodeId,
            pluginId: identity.pluginId,
            nodeType: identity.nodeType,
            changed,
            result,
          }, null, 2);
        } catch (err) {
          return `Error: plugin node write failed: ${errorMessage(err)}`;
        }
      },
    },

    canvas_plugin_node_action: {
      name: 'canvas_plugin_node_action',
      description:
        'Execute a named action on a custom plugin node through its registered action capability. ' +
        'Examples: increment a mock card, sync a design frame, run a plugin-specific transform. ' +
        'Use this only for type="plugin" nodes that list the action capability.',
      inputSchema: z.object({
        nodeId: z.string().describe('The plugin node id to act on.'),
        action: z.string().describe('Action id registered by the plugin, e.g. "increment".'),
        input: z.record(z.string(), z.unknown()).optional().describe('Action-specific JSON input.'),
        workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace.'),
      }),
      execute: async (input) => {
        const targetWorkspaceId = targetWorkspace(input, workspaceId);
        const nodeId = input.nodeId as string;
        const action = (input.action as string).trim();
        if (!action) return 'Error: action is required.';

        const canvas = await loadCanvas(targetWorkspaceId);
        if (!canvas) return `Error: workspace not found: ${targetWorkspaceId}`;

        const node = findNode(canvas.nodes, nodeId);
        if (!node) return `Error: node not found: ${nodeId}`;
        const resolved = resolvePluginNodeCapability(node);
        const identity = getPluginNodeIdentity(node);
        if (!identity) return `Error: node is not a valid plugin node: ${nodeId}`;

        const handler = resolved?.entry.capabilities.actions?.[action];
        if (!handler) {
          const actions = availableActions(node);
          const suffix = actions.length ? ` Available actions: ${actions.join(', ')}` : '';
          return `Error: plugin node action is not registered: ${identity.pluginId}/${identity.nodeType}.${action}.${suffix}`;
        }

        try {
          const actionInput = isRecord(input.input) ? input.input : {};
          const result = await handler({
            workspaceId: targetWorkspaceId,
            node: node as unknown as SharedCanvasNode,
          }, actionInput);
          const patch = patchFromActionResult(result);
          const changed = applyPluginNodePatch(node, patch);
          if (changed) {
            await saveCanvas(targetWorkspaceId, canvas);
            broadcastUpdate(targetWorkspaceId, [nodeId]);
          }
          return JSON.stringify({
            ok: true,
            nodeId,
            pluginId: identity.pluginId,
            nodeType: identity.nodeType,
            action,
            changed,
            result: actionPublicResult(result),
          }, null, 2);
        } catch (err) {
          return `Error: plugin node action failed: ${errorMessage(err)}`;
        }
      },
    },
  };
}
