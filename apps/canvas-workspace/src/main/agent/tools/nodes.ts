import { promises as fs } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { generateHTML } from '../../generation/html-generator';
import type { CanvasNode, CanvasTool, NodeType, RawMindmapTopic } from './types';
import { STORE_DIR, loadCanvas, saveCanvas } from './_shared/canvas-io';
import { broadcastUpdate } from './_shared/broadcast';
import {
  DEFAULT_DIMENSIONS,
  INLINE_PROMPT_THRESHOLD,
  placementIntentSchema,
  resolvePlacement,
  type PlacementIntent,
} from './_shared/placement';
import { genTopicId, normalizeMindmapTopic } from './_shared/mindmap';
import { normalizeIframeUrl, shouldCreateIframeForHtml } from './_shared/iframe';
import {
  MOCK_CARD_DEFAULT_PAYLOAD,
  MOCK_CARD_NODE_TYPE,
  MOCK_NODE_PLUGIN_ID,
  MOCK_TODO_LIST_DEFAULT_PAYLOAD,
  MOCK_TODO_LIST_NODE_TYPE,
} from '../../../plugins/mock-node/constants';
import { createNodeReadTools } from './node-read-tools';
import { getCanvasCapabilityRuntime } from '../../runtime/capabilities';

export function createNodeTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    ...createNodeReadTools(workspaceId),

    canvas_create_node: {
      name: 'canvas_create_node',
      description:
        'Create a new node on the canvas.\n' +
        '- **file**: Creates a markdown note with a backing file. Use `content` for initial text. If `content` is full HTML, or `data.contentType: "text/html"` / `data.renderAs: "html"` is provided, it is automatically created as a renderable iframe HTML node instead. Use `data.renderAs: "note"` to force a markdown note.\n' +
        '- **image**: Creates an image node from `data.filePath` (absolute local path). Prefer `canvas_generate_image` when the user asks AI to create an image.\n' +
        '- **terminal**: Spawns an interactive shell session on the canvas. The PTY starts automatically. Use `data.cwd` to set the working directory.\n' +
        '- **frame**: Creates a named spatial container. Use `data.color` (hex) and `data.label`.\n' +
        '- **group**: Creates a lightweight grouping relationship. Use `data.childIds` for members, plus optional `data.color` (hex) and `data.label`.\n' +
        '- **agent**: Creates an AI agent node (Claude Code or Codex). ' +
        'Set `data.agentType`, `data.cwd`, `data.status: "running"` to auto-launch, `data.prompt` for initial context, and optional `data.agentArgs`.\n' +
        '- **text**: Creates a free-form text label (TLDRAW-style). Use `content` for the text body, ' +
        'and `data.textColor` / `data.backgroundColor` (hex or "transparent") for styling. Optional `data.fontSize`.\n' +
        '- **iframe**: Embeds an external web page, renders raw HTML, or generates HTML from a prompt. ' +
        'Use `data.url` for URL mode, `data.html` + `data.mode: "html"` for raw HTML, or `data.prompt` + `data.mode: "ai"` for generated HTML. ' +
        'Note: some sites block URL embedding via X-Frame-Options / CSP.\n' +
        '- **shape**: Draws a primitive geometric shape (rectangle or ellipse). ' +
        'Use `data.kind` ("rect" | "ellipse"), `data.fill` / `data.stroke` (hex or "transparent"), ' +
        'and `data.strokeWidth` (px). For precise sizing pass explicit `x`, `y`, and set width/height ' +
        'via the dedicated `canvas_create_shape` tool — this generic one uses default dimensions.\n' +
        '- **mindmap**: Creates a radial mindmap. Pass `data.root` as a recursive topic tree ' +
        '`{ text: string, children?: Topic[], color?: string, collapsed?: boolean }`; topic ids are auto-generated.\n' +
        '- **plugin**: Creates a custom plugin node shell. Pass `data.pluginId`, `data.nodeType`, and optional `data.payload`. ' +
        'For the built-in MVP mock nodes, use `{ pluginId: "mock", nodeType: "mock.card", payload: { text?: string, count?: number } }` ' +
        'or `{ pluginId: "mock", nodeType: "mock.todo-list", payload: { title?: string, items?: Array<{ id?: string, text: string, done?: boolean }> } }`.',
      inputSchema: z.object({
        type: z.enum(['file', 'terminal', 'frame', 'group', 'agent', 'text', 'iframe', 'image', 'shape', 'mindmap', 'plugin']).describe('Node type.'),
        title: z.string().optional().describe('Node title.'),
        content: z.string().optional().describe('Initial content (for file and text nodes).'),
        x: z.number().optional().describe('X position (auto-placed if omitted).'),
        y: z.number().optional().describe('Y position (auto-placed if omitted).'),
        width: z.number().min(40).optional().describe('Node width in canvas px. Defaults by type if omitted.'),
        height: z.number().min(40).optional().describe('Node height in canvas px. Defaults by type if omitted.'),
        placement: placementIntentSchema.optional().describe(
          'Semantic insertion strategy for the agent. Use near_node for derived notes, inside_frame for adding to an existing frame, at for a preferred canvas point, or omit to append to the canvas without moving existing nodes.',
        ),
        data: z.record(z.string(), z.unknown()).optional().describe(
          'Additional node data. Keys vary by type:\n' +
          '- terminal: { cwd?: string }\n' +
          '- agent: { agentType?: "claude-code"|"codex", cwd?: string, status?: "idle"|"running", prompt?: string, agentArgs?: string }\n' +
          '- frame: { color?: string, label?: string }\n' +
          '- group: { color?: string, label?: string, childIds?: string[] }\n' +
          '- text: { textColor?: string, backgroundColor?: string, fontSize?: number }\n' +
          '- iframe: { url?: string, html?: string, prompt?: string, mode?: \"url\"|\"html\"|\"ai\" }. `url: \"blank\"` opens about:blank.\\n' +
          '- file HTML routing: { contentType?: \"text/html\", renderAs?: \"html\"|\"note\" }\\n' +
          '- shape: { kind?: "rect"|"rounded-rect"|"ellipse"|"triangle"|"diamond"|"hexagon"|"star", fill?: string, stroke?: string, strokeWidth?: number, text?: string, textColor?: string, fontSize?: number }\n' +
          '- mindmap: { root?: { text: string, children?: Topic[], color?: string, collapsed?: boolean } } where Topic has the same recursive shape\n' +
          '- plugin: { pluginId: string, nodeType: string, payload?: Record<string, unknown>, version?: string }. Defaults to the built-in mock.card plugin node. Use nodeType "mock.todo-list" for a Todo List plugin node.',
        ),
      }),
      execute: async (input) => {
        const requestedNodeType = input.type as NodeType;
        const content = (input.content as string) ?? '';
        const extraData = (input.data as Record<string, unknown>) ?? {};
        const nodeType: NodeType = shouldCreateIframeForHtml(requestedNodeType, content, extraData) ? 'iframe' : requestedNodeType;
        const defaultTitle = nodeType === 'plugin' && extraData.nodeType === MOCK_TODO_LIST_NODE_TYPE
          ? MOCK_TODO_LIST_DEFAULT_PAYLOAD.title
          : DEFAULT_DIMENSIONS[nodeType]?.title ?? 'Untitled';
        const title = (input.title as string) ?? defaultTitle;

        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const def = DEFAULT_DIMENSIONS[nodeType];
        if (!def) return `Error: unsupported node type: ${nodeType}`;

        const width = (input.width as number | undefined) ?? def.width;
        const height = (input.height as number | undefined) ?? def.height;
        let pos: { x: number; y: number };
        try {
          pos = resolvePlacement(
            canvas.nodes,
            { width, height },
            { x: input.x as number | undefined, y: input.y as number | undefined },
            input.placement as PlacementIntent | undefined,
          );
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

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
          case 'group':
            nodeData = {
              color: (extraData.color as string) ?? '#A594E0',
              label: (extraData.label as string) ?? '',
              childIds: Array.isArray(extraData.childIds)
                ? extraData.childIds.filter((id): id is string => typeof id === 'string')
                : [],
            };
            break;
          case 'agent': {
            const requestedStatus = (extraData.status as string) ?? 'idle';
            const validStatuses = ['idle', 'running'];
            const status = validStatuses.includes(requestedStatus) ? requestedStatus : 'idle';
            const agentCwd = (extraData.cwd as string) ?? '';
            const prompt = (extraData.prompt as string) ?? '';
            const agentArgs = (extraData.agentArgs as string) ?? '';

            // Short prompt → inline CLI arg; long prompt → file
            let inlinePrompt = '';
            let promptFile = '';
            if (prompt && agentCwd) {
              if (prompt.length <= INLINE_PROMPT_THRESHOLD) {
                inlinePrompt = prompt;
              } else {
                promptFile = '.canvas-agent-task.md';
                await fs.mkdir(agentCwd, { recursive: true });
                await fs.writeFile(join(agentCwd, promptFile), prompt, 'utf-8');
              }
            }

            nodeData = {
              sessionId: '',
              cwd: agentCwd,
              agentType: (extraData.agentType as string) ?? 'claude-code',
              status,
              agentArgs,
              inlinePrompt,
              promptFile,
            };
            break;
          }
          case 'text':
            nodeData = {
              content,
              textColor: (extraData.textColor as string) ?? '#1f2328',
              backgroundColor: (extraData.backgroundColor as string) ?? 'transparent',
              fontSize: (extraData.fontSize as number) ?? 18,
            };
            break;
          case 'image':
            nodeData = { filePath: (extraData.filePath as string) ?? '' };
            break;
          case 'iframe': {
            const rawMode = extraData.mode as string | undefined;
            const forcedHtml = requestedNodeType === 'file' && nodeType === 'iframe';
            const iframeMode = forcedHtml ? 'html' : rawMode === 'html' ? 'html' : rawMode === 'ai' ? 'ai' : 'url';
            const prompt = (extraData.prompt as string) ?? '';

            if (iframeMode === 'ai' && prompt) {
              // Generate HTML from the prompt via LLM
              const genResult = await generateHTML(prompt);
              nodeData = {
                url: '',
                html: genResult.ok ? (genResult.html ?? '') : `<pre style="color:red">${genResult.error ?? 'Generation failed'}</pre>`,
                prompt,
                mode: 'ai',
              };
            } else {
              nodeData = {
                url: forcedHtml ? '' : normalizeIframeUrl(extraData.url),
                html: forcedHtml ? content : (extraData.html as string) ?? '',
                prompt,
                mode: iframeMode,
              };
            }
            break;
          }
          case 'shape': {
            const validKinds = ['rect', 'rounded-rect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star'];
            const rawKind = extraData.kind as string | undefined;
            const shapeKind = rawKind && validKinds.includes(rawKind) ? rawKind : 'rect';
            nodeData = {
              kind: shapeKind,
              fill: (extraData.fill as string) ?? '#E8EEF7',
              stroke: (extraData.stroke as string) ?? '#5B7CBF',
              strokeWidth: (extraData.strokeWidth as number) ?? 2,
              text: (extraData.text as string) ?? (content || ''),
              textColor: extraData.textColor as string | undefined,
              fontSize: extraData.fontSize as number | undefined,
            };
            break;
          }
          case 'mindmap': {
            const rawRoot = extraData.root as RawMindmapTopic | undefined;
            const root = rawRoot
              ? normalizeMindmapTopic(rawRoot)
              : {
                  id: genTopicId(),
                  text: input.title ? title : 'Central topic',
                  children: [],
                };
            nodeData = {
              root,
              layout: 'right',
              rev: 0,
            };
            break;
          }
          case 'plugin': {
            const pluginId = typeof extraData.pluginId === 'string' && extraData.pluginId.trim()
              ? extraData.pluginId.trim()
              : MOCK_NODE_PLUGIN_ID;
            const pluginNodeType = typeof extraData.nodeType === 'string' && extraData.nodeType.trim()
              ? extraData.nodeType.trim()
              : MOCK_CARD_NODE_TYPE;
            const payload = extraData.payload && typeof extraData.payload === 'object' && !Array.isArray(extraData.payload)
              ? extraData.payload as Record<string, unknown>
              : pluginNodeType === MOCK_TODO_LIST_NODE_TYPE
                ? {
                    title: MOCK_TODO_LIST_DEFAULT_PAYLOAD.title,
                    items: MOCK_TODO_LIST_DEFAULT_PAYLOAD.items.map((item) => ({ ...item })),
                  }
                : { ...MOCK_CARD_DEFAULT_PAYLOAD };
            nodeData = {
              pluginId,
              nodeType: pluginNodeType,
              payload,
              version: typeof extraData.version === 'string' ? extraData.version : undefined,
            };
            break;
          }
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
          width,
          height,
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
          x: pos.x,
          y: pos.y,
          width,
          height,
        });
      },
    },

    canvas_update_node: {
      name: 'canvas_update_node',
      description:
        'Update an existing canvas node. For file and text nodes, updates `content`. For frame nodes, updates label/color. For text nodes, `data.textColor`/`data.backgroundColor`/`data.fontSize` can also be patched.',
      inputSchema: z.object({
        nodeId: z.string().describe('The ID of the node to update.'),
        title: z.string().optional().describe('New title (optional).'),
        content: z.string().optional().describe('New content for file and text nodes.'),
        data: z.record(z.string(), z.unknown()).optional().describe('Partial data update (e.g. label, color for frames; textColor, backgroundColor, fontSize for text).'),
      }),
      execute: async (input, context) => {
        const result = await getCanvasCapabilityRuntime().call(
          'canvas.nodes.update',
          input,
          {
            workspaceId,
            actor: { kind: 'canvas-agent' },
            abortSignal: context?.abortSignal,
          },
        );
        if (!result.ok) return `Error: ${result.error.message}`;
        return JSON.stringify({ ok: true, ...(result.value as object) });
      },
    },

    canvas_delete_node: {
      name: 'canvas_delete_node',
      defer_loading: true,
      description: 'Delete a node from the canvas.',
      inputSchema: z.object({
        nodeId: z.string().describe('The ID of the node to delete.'),
      }),
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
        // Deleting the last remaining node legitimately leaves nodes=[];
        // opt in so the wipe guard doesn't refuse that case.
        await saveCanvas(workspaceId, fresh, { allowEmpty: true });
        broadcastUpdate(workspaceId, [nodeId]);

        return JSON.stringify({ ok: true, nodeId });
      },
    },

    canvas_move_node: {
      name: 'canvas_move_node',
      defer_loading: true,
      description: 'Move a node to a new position on the canvas.',
      inputSchema: z.object({
        nodeId: z.string().describe('The ID of the node to move.'),
        x: z.number().describe('New X position.'),
        y: z.number().describe('New Y position.'),
      }),
      execute: async (input) => {
        const nodeId = input.nodeId as string;

        // Single read against the latest disk state, then mutate that
        // snapshot in place. Reading once (instead of load → mutate-stale
        // → re-read → splice) means concurrent updates to OTHER fields of
        // this node — last edit by the user, content changes from the
        // CLI — are not silently overwritten with a pre-move copy.
        const fresh = await loadCanvas(workspaceId);
        if (!fresh) return 'Error: workspace not found';
        const idx = fresh.nodes.findIndex(n => n.id === nodeId);
        if (idx === -1) return `Error: node not found: ${nodeId}`;
        const node = fresh.nodes[idx];

        node.x = input.x as number;
        node.y = input.y as number;
        node.updatedAt = Date.now();

        await saveCanvas(workspaceId, fresh);
        broadcastUpdate(workspaceId, [nodeId]);

        return JSON.stringify({ ok: true, nodeId });
      },
    },
  };
}
