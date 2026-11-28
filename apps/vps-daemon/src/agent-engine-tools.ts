import type { PulseStorage } from '@pulse-coder/storage';
import type { Tool } from 'pulse-coder-engine';
import { z } from 'zod';
import { executeCanvasAgentTool, type CanvasAgentToolName } from './agent-canvas-tools.js';
import { loadVpsSkill } from './agent-skills.js';
import { executeRemoteBuiltinTool, type RemoteBuiltinToolName } from './tools-rpc.js';

export interface VpsEngineToolsContext {
  storage: PulseStorage;
  workspaceId: string;
  workDir: string;
  signal: AbortSignal;
  onMutation?: () => void;
}

export function createVpsEngineTools(ctx: VpsEngineToolsContext): Record<string, Tool> {
  const { storage, workspaceId, workDir, signal, onMutation } = ctx;

  const runBuiltin = (name: RemoteBuiltinToolName) => async (input: Record<string, unknown>) =>
    executeRemoteBuiltinTool(name, input, workDir, signal);

  const runCanvas = (name: CanvasAgentToolName) => async (input: Record<string, unknown>) =>
    executeCanvasAgentTool(name, input, storage, workspaceId, onMutation);

  return {
    bash: {
      name: 'bash',
      description:
        'Run a shell command in the VPS workspace directory. Use for running tests, scripts, git, builds, or inspecting the environment.',
      inputSchema: z.object({
        command: z.string().describe('Shell command to execute via /bin/bash.'),
        cwd: z.string().optional().describe('Optional working directory override.'),
        timeout: z.number().optional().describe('Optional timeout in milliseconds (default 120000).'),
      }),
      execute: runBuiltin('bash'),
    },
    read: {
      name: 'read',
      description: 'Read a text file from the VPS workspace with optional line range.',
      inputSchema: z.object({
        filePath: z.string().describe('Relative or absolute file path.'),
        offset: z.number().optional().describe('1-based start line number.'),
        limit: z.number().optional().describe('Maximum number of lines to read.'),
      }),
      execute: runBuiltin('read'),
    },
    write: {
      name: 'write',
      description: 'Create or overwrite a text file in the VPS workspace.',
      inputSchema: z.object({
        filePath: z.string().describe('Relative or absolute file path.'),
        content: z.string().describe('Full file content to write.'),
      }),
      execute: runBuiltin('write'),
    },
    edit: {
      name: 'edit',
      description: 'Replace an exact text snippet inside an existing file.',
      inputSchema: z.object({
        filePath: z.string().describe('Relative or absolute file path.'),
        oldString: z.string().describe('Exact text to find.'),
        newString: z.string().describe('Replacement text.'),
        replaceAll: z.boolean().optional().describe('Replace all occurrences if true.'),
      }),
      execute: runBuiltin('edit'),
    },
    ls: {
      name: 'ls',
      description: 'List files and directories inside a path.',
      inputSchema: z.object({
        path: z.string().optional().describe('Directory path (defaults to workspace root).'),
      }),
      execute: runBuiltin('ls'),
    },
    grep: {
      name: 'grep',
      description: 'Search text or regex pattern across files in the VPS workspace.',
      inputSchema: z.object({
        pattern: z.string().describe('Regex or literal search pattern.'),
        path: z.string().optional().describe('Directory or file to search (defaults to workspace root).'),
        include: z.string().optional().describe('Optional file glob filter (e.g. "*.ts").'),
      }),
      execute: runBuiltin('grep'),
    },
    canvas_get_overview: {
      name: 'canvas_get_overview',
      description:
        'List all nodes (id, type, title, position, preview) and edges on the current Pulse Canvas workspace.',
      inputSchema: z.object({}),
      execute: runCanvas('canvas_get_overview'),
    },
    canvas_read_node: {
      name: 'canvas_read_node',
      description: 'Read the full content and metadata of a specific canvas node by nodeId.',
      inputSchema: z.object({
        nodeId: z.string().describe('Target canvas node ID.'),
      }),
      execute: runCanvas('canvas_read_node'),
    },
    canvas_create_node: {
      name: 'canvas_create_node',
      description:
        'Create a new card/node on the Pulse Canvas (text note, frame, or url) and optionally connect it from an existing node.',
      inputSchema: z.object({
        type: z.enum(['text', 'frame', 'url']).optional().describe('Node type (default: text).'),
        title: z.string().describe('Node title.'),
        content: z.string().optional().describe('Markdown content for text nodes.'),
        url: z.string().optional().describe('URL for url nodes.'),
        color: z.string().optional().describe('Optional accent color key.'),
        x: z.number().optional().describe('Optional x coordinate.'),
        y: z.number().optional().describe('Optional y coordinate.'),
        width: z.number().optional().describe('Optional width.'),
        height: z.number().optional().describe('Optional height.'),
        connectFromNodeId: z.string().optional().describe('Optional source node ID to connect an edge from.'),
        edgeLabel: z.string().optional().describe('Optional label for the created edge.'),
      }),
      execute: runCanvas('canvas_create_node'),
    },
    canvas_update_node: {
      name: 'canvas_update_node',
      description: 'Update an existing canvas node title, markdown content, color, or geometry.',
      inputSchema: z.object({
        nodeId: z.string().describe('Target canvas node ID.'),
        title: z.string().optional().describe('Updated title.'),
        content: z.string().optional().describe('Updated markdown content.'),
        color: z.string().optional().describe('Updated color.'),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
      }),
      execute: runCanvas('canvas_update_node'),
    },
    canvas_delete_node: {
      name: 'canvas_delete_node',
      description: 'Delete a canvas node and its connected edges.',
      inputSchema: z.object({
        nodeId: z.string().describe('Target canvas node ID.'),
      }),
      execute: runCanvas('canvas_delete_node'),
    },
    canvas_create_edge: {
      name: 'canvas_create_edge',
      description: 'Connect two canvas nodes with a directed edge.',
      inputSchema: z.object({
        fromNode: z.string().describe('Source node ID.'),
        toNode: z.string().describe('Target node ID.'),
        label: z.string().optional().describe('Optional edge label.'),
      }),
      execute: runCanvas('canvas_create_edge'),
    },
    load_skill: {
      name: 'load_skill',
      description: 'Load full instructions of a skill installed in .pulse-coder/skills/ by name.',
      inputSchema: z.object({
        name: z.string().describe('Skill name from the available skills list.'),
      }),
      execute: async (input: { name: string }) => {
        const detail = await loadVpsSkill(workDir, input.name);
        return detail
          ? { ok: true, name: detail.name, description: detail.description, content: detail.content }
          : { ok: false, error: `Skill not found: ${input.name}` };
      },
    },
  };
}
