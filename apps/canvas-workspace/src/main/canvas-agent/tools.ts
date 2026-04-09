/**
 * Canvas-specific tools for the Canvas Agent.
 *
 * These tools operate directly on the canvas filesystem (canvas.json + notes/)
 * in the Electron main process. They do NOT go through the CLI.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { BrowserWindow } from 'electron';
import {
  buildWorkspaceSummary,
  buildDetailedContext,
  readNodeDetail,
  formatSummaryForPrompt,
} from './context-builder';

const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');

// ─── Types mirrored from canvas-cli ────────────────────────────────

type NodeType = 'file' | 'terminal' | 'frame' | 'agent';

interface CanvasNode {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data: Record<string, unknown>;
  updatedAt?: number;
}

interface CanvasSaveData {
  nodes: CanvasNode[];
  transform: { x: number; y: number; scale: number };
  savedAt: string;
}

const DEFAULT_DIMENSIONS: Record<NodeType, { title: string; width: number; height: number }> = {
  file: { title: 'Untitled', width: 420, height: 360 },
  terminal: { title: 'Terminal', width: 480, height: 300 },
  frame: { title: 'Frame', width: 600, height: 400 },
  agent: { title: 'Agent', width: 520, height: 380 },
};

// ─── Helpers ───────────────────────────────────────────────────────

function canvasPath(workspaceId: string): string {
  return join(STORE_DIR, workspaceId, 'canvas.json');
}

async function loadCanvas(workspaceId: string): Promise<CanvasSaveData | null> {
  try {
    const raw = await fs.readFile(canvasPath(workspaceId), 'utf-8');
    const data = JSON.parse(raw) as CanvasSaveData;
    data.nodes = data.nodes ?? [];
    return data;
  } catch {
    return null;
  }
}

async function saveCanvas(workspaceId: string, data: CanvasSaveData): Promise<void> {
  data.savedAt = new Date().toISOString();
  await fs.writeFile(canvasPath(workspaceId), JSON.stringify(data, null, 2), 'utf-8');
}

function broadcastUpdate(workspaceId: string, nodeIds: string[]): void {
  const payload = {
    type: 'canvas:updated' as const,
    workspaceId,
    nodeIds,
    source: 'canvas-agent' as const,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('canvas:external-update', payload);
  }
}

function autoPlace(nodes: CanvasNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 100, y: 100 };
  let maxRight = 0;
  let bestY = 100;
  for (const n of nodes) {
    const right = n.x + n.width;
    if (right > maxRight) {
      maxRight = right;
      bestY = n.y;
    }
  }
  return { x: maxRight + 40, y: bestY };
}

// ─── Tool definitions ──────────────────────────────────────────────

export interface CanvasToolDefs {
  [name: string]: {
    description: string;
    parameters: Record<string, unknown>;
    execute: (input: Record<string, unknown>) => Promise<string>;
  };
}

export function createCanvasTools(workspaceId: string): CanvasToolDefs {
  return {
    canvas_read_context: {
      description:
        'Read the current workspace context. Use detail="summary" (default) for a quick overview of all nodes, or detail="full" to include file contents and terminal scrollback.',
      parameters: {
        type: 'object',
        properties: {
          detail: {
            type: 'string',
            enum: ['summary', 'full'],
            description: 'Level of detail. "summary" returns node list with metadata. "full" includes file contents and terminal scrollback.',
          },
        },
      },
      execute: async (input) => {
        const detail = (input.detail as string) ?? 'summary';
        if (detail === 'full') {
          const ctx = await buildDetailedContext(workspaceId);
          if (!ctx) return 'Error: workspace not found';
          return JSON.stringify(ctx, null, 2);
        }
        const summary = await buildWorkspaceSummary(workspaceId);
        if (!summary) return 'Error: workspace not found';
        return formatSummaryForPrompt(summary);
      },
    },

    canvas_read_node: {
      description:
        'Read the full content of a specific canvas node. For file nodes, returns the file content. For terminal/agent nodes, returns scrollback output.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'The ID of the node to read.' },
        },
        required: ['nodeId'],
      },
      execute: async (input) => {
        const nodeId = input.nodeId as string;
        const detail = await readNodeDetail(workspaceId, nodeId);
        if (!detail) return `Error: node not found: ${nodeId}`;
        return JSON.stringify(detail, null, 2);
      },
    },

    canvas_create_node: {
      description:
        'Create a new node on the canvas. For file nodes, a notes file is automatically created in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['file', 'terminal', 'frame', 'agent'], description: 'Node type.' },
          title: { type: 'string', description: 'Node title.' },
          content: { type: 'string', description: 'Initial content (for file nodes).' },
          x: { type: 'number', description: 'X position (auto-placed if omitted).' },
          y: { type: 'number', description: 'Y position (auto-placed if omitted).' },
          data: { type: 'object', description: 'Additional node data (e.g. color/label for frames, cwd for terminals).' },
        },
        required: ['type'],
      },
      execute: async (input) => {
        const nodeType = input.type as NodeType;
        const title = (input.title as string) ?? DEFAULT_DIMENSIONS[nodeType]?.title ?? 'Untitled';
        const content = (input.content as string) ?? '';
        const extraData = (input.data as Record<string, unknown>) ?? {};

        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const def = DEFAULT_DIMENSIONS[nodeType];
        if (!def) return `Error: unsupported node type: ${nodeType}`;

        const pos = (input.x != null && input.y != null)
          ? { x: input.x as number, y: input.y as number }
          : autoPlace(canvas.nodes);

        let nodeData: Record<string, unknown>;
        switch (nodeType) {
          case 'file':
            nodeData = { filePath: '', content, saved: false, modified: false };
            break;
          case 'terminal':
            nodeData = { sessionId: '', cwd: (extraData.cwd as string) ?? '' };
            break;
          case 'frame':
            nodeData = {
              color: (extraData.color as string) ?? '#9575d4',
              label: (extraData.label as string) ?? '',
            };
            break;
          case 'agent':
            nodeData = {
              sessionId: '',
              cwd: (extraData.cwd as string) ?? '',
              agentType: (extraData.agentType as string) ?? 'claude-code',
              status: 'idle',
            };
            break;
        }

        // For file nodes, create a backing notes file
        if (nodeType === 'file') {
          const notesDir = join(STORE_DIR, workspaceId, 'notes');
          await fs.mkdir(notesDir, { recursive: true });
          const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_');
          const noteFile = join(notesDir, `${safeTitle}-${nodeId}.md`);
          await fs.writeFile(noteFile, content, 'utf-8');
          nodeData.filePath = noteFile;
          nodeData.saved = true;
          nodeData.modified = false;
        }

        const newNode: CanvasNode = {
          id: nodeId,
          type: nodeType,
          title,
          x: pos.x,
          y: pos.y,
          width: def.width,
          height: def.height,
          data: nodeData,
          updatedAt: Date.now(),
        };

        // Re-read canvas before writing to avoid clobbering concurrent changes
        const fresh = (await loadCanvas(workspaceId)) ?? canvas;
        fresh.nodes.push(newNode);
        await saveCanvas(workspaceId, fresh);
        broadcastUpdate(workspaceId, [nodeId]);

        return JSON.stringify({
          ok: true,
          nodeId,
          type: nodeType,
          title,
        });
      },
    },

    canvas_update_node: {
      description:
        'Update an existing canvas node. For file nodes, updates the file content. For frame nodes, updates label/color.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'The ID of the node to update.' },
          title: { type: 'string', description: 'New title (optional).' },
          content: { type: 'string', description: 'New content for file nodes.' },
          data: { type: 'object', description: 'Partial data update (e.g. label, color for frames).' },
        },
        required: ['nodeId'],
      },
      execute: async (input) => {
        const nodeId = input.nodeId as string;
        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        const node = canvas.nodes.find(n => n.id === nodeId);
        if (!node) return `Error: node not found: ${nodeId}`;

        if (input.title) node.title = input.title as string;

        if (node.type === 'file' && input.content != null) {
          const content = input.content as string;
          node.data.content = content;
          if (node.data.filePath) {
            await fs.writeFile(node.data.filePath as string, content, 'utf-8');
          }
        }

        if (input.data) {
          const patch = input.data as Record<string, unknown>;
          for (const [k, v] of Object.entries(patch)) {
            node.data[k] = v;
          }
        }

        node.updatedAt = Date.now();

        // Re-read and commit
        const fresh = (await loadCanvas(workspaceId)) ?? canvas;
        const idx = fresh.nodes.findIndex(n => n.id === nodeId);
        if (idx >= 0) fresh.nodes[idx] = node;
        await saveCanvas(workspaceId, fresh);
        broadcastUpdate(workspaceId, [nodeId]);

        return JSON.stringify({ ok: true, nodeId });
      },
    },

    canvas_delete_node: {
      description: 'Delete a node from the canvas.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'The ID of the node to delete.' },
        },
        required: ['nodeId'],
      },
      execute: async (input) => {
        const nodeId = input.nodeId as string;
        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        const idx = canvas.nodes.findIndex(n => n.id === nodeId);
        if (idx === -1) return `Error: node not found: ${nodeId}`;

        // Re-read and commit
        const fresh = (await loadCanvas(workspaceId)) ?? canvas;
        const freshIdx = fresh.nodes.findIndex(n => n.id === nodeId);
        if (freshIdx >= 0) fresh.nodes.splice(freshIdx, 1);
        await saveCanvas(workspaceId, fresh);
        broadcastUpdate(workspaceId, [nodeId]);

        return JSON.stringify({ ok: true, nodeId });
      },
    },

    canvas_move_node: {
      description: 'Move a node to a new position on the canvas.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'The ID of the node to move.' },
          x: { type: 'number', description: 'New X position.' },
          y: { type: 'number', description: 'New Y position.' },
        },
        required: ['nodeId', 'x', 'y'],
      },
      execute: async (input) => {
        const nodeId = input.nodeId as string;
        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        const node = canvas.nodes.find(n => n.id === nodeId);
        if (!node) return `Error: node not found: ${nodeId}`;

        node.x = input.x as number;
        node.y = input.y as number;
        node.updatedAt = Date.now();

        const fresh = (await loadCanvas(workspaceId)) ?? canvas;
        const idx = fresh.nodes.findIndex(n => n.id === nodeId);
        if (idx >= 0) fresh.nodes[idx] = node;
        await saveCanvas(workspaceId, fresh);
        broadcastUpdate(workspaceId, [nodeId]);

        return JSON.stringify({ ok: true, nodeId });
      },
    },
  };
}
