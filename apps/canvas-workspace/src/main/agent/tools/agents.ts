import { promises as fs } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { sendInputToAgentNode } from '../session-send';
import { readWorkspaceMeta } from '../workspace-meta';
import type { CanvasNode, CanvasTool } from './types';
import { loadCanvas, saveCanvas } from './_shared/canvas-io';
import { broadcastUpdate } from './_shared/broadcast';
import { autoPlace, DEFAULT_DIMENSIONS, INLINE_PROMPT_THRESHOLD } from './_shared/placement';

export function createAgentTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_create_agent_node: {
      name: 'canvas_create_agent_node',
      description:
        'Create and optionally auto-launch an AI agent node on the canvas. ' +
        'Use this when you need to delegate a task to another agent (Claude Code or Codex). ' +
        'Set `prompt` with task instructions and relevant canvas context so the agent knows what to do. ' +
        'The prompt is piped directly to the agent as its initial prompt.',
      inputSchema: z.object({
        title: z.string().optional().describe('Node title (e.g. "Codex: Implement login").'),
        agentType: z.enum(['claude-code', 'codex']).optional()
          .describe('Agent type. Defaults to "claude-code".'),
        cwd: z.string().optional()
          .describe('Working directory for the agent. Defaults to the workspace root folder when set; omit unless the agent needs to run outside the workspace root.'),
        prompt: z.string().optional()
          .describe('Task instructions and context for the agent. Written to .canvas-agent-task.md in cwd. Include relevant canvas content (file contents, PRDs, terminal output, etc.) so the agent has full context.'),
        autoLaunch: z.boolean().optional()
          .describe('Set to true to launch the agent immediately (default: true when prompt is provided, false otherwise).'),
        agentArgs: z.string().optional()
          .describe('Override the auto-generated CLI arguments. Rarely needed when using prompt.'),
        x: z.number().optional().describe('X position (auto-placed if omitted).'),
        y: z.number().optional().describe('Y position (auto-placed if omitted).'),
      }),
      execute: async (input) => {
        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        const agentType = (input.agentType as string) ?? 'claude-code';
        const explicitCwd = (input.cwd as string | undefined) ?? '';
        const cwd = explicitCwd || (await readWorkspaceMeta(workspaceId)).rootFolder || '';
        const prompt = (input.prompt as string) ?? '';
        const agentArgs = (input.agentArgs as string) ?? '';
        const autoLaunch = input.autoLaunch ?? !!prompt;
        const title = (input.title as string) ?? DEFAULT_DIMENSIONS.agent.title;

        // Short prompt → inline CLI arg; long prompt → file
        let inlinePrompt = '';
        let promptFile = '';
        if (prompt && cwd) {
          if (prompt.length <= INLINE_PROMPT_THRESHOLD) {
            inlinePrompt = prompt;
          } else {
            promptFile = '.canvas-agent-task.md';
            await fs.mkdir(cwd, { recursive: true });
            await fs.writeFile(join(cwd, promptFile), prompt, 'utf-8');
          }
        }

        const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const def = DEFAULT_DIMENSIONS.agent;
        const pos = (input.x != null && input.y != null)
          ? { x: input.x as number, y: input.y as number }
          : autoPlace(canvas.nodes);

        const newNode: CanvasNode = {
          id: nodeId,
          type: 'agent',
          title,
          x: pos.x,
          y: pos.y,
          width: def.width,
          height: def.height,
          data: {
            sessionId: '',
            cwd,
            agentType,
            status: autoLaunch ? 'running' : 'idle',
            agentArgs,
            inlinePrompt,
            promptFile,
          },
          updatedAt: Date.now(),
        };

        const fresh = (await loadCanvas(workspaceId)) ?? canvas;
        fresh.nodes.push(newNode);
        await saveCanvas(workspaceId, fresh);
        broadcastUpdate(workspaceId, [nodeId]);

        return JSON.stringify({ ok: true, nodeId, agentType, title, autoLaunch });
      },
    },

    // ─── Follow-up input to an existing agent node ──────────────────

    canvas_send_to_agent: {
      name: 'canvas_send_to_agent',
      defer_loading: true,
      description:
        'Send a follow-up prompt to an existing, RUNNING agent node (Claude Code / Codex). ' +
        'Writes the text directly to the agent\'s PTY as if the user typed it, and auto-appends Enter ' +
        '(a carriage return) so the agent receives and executes it immediately — you do NOT need to ' +
        'call this twice or send a separate newline. ' +
        'Use this for any interaction AFTER the initial launch: follow-up questions, corrections, ' +
        'redirections, approvals, etc. ' +
        'For the FIRST launch of a brand-new agent, use `canvas_create_agent_node` instead. ' +
        'Requirements: the target node must be `type="agent"`, `status="running"`, and its backing PTY ' +
        'session must still be alive (the agent node must be open in the canvas UI — closing the node ' +
        'tears down the PTY).',
      inputSchema: z.object({
        nodeId: z.string().describe('The agent node ID to send the prompt to.'),
        input: z.string().describe(
          'The text to send. Enter is appended automatically, so provide exactly what you want the ' +
          'agent to receive as one submission — no trailing newline needed.',
        ),
      }),
      execute: async (input) => {
        const nodeId = input.nodeId as string;
        const text = (input.input as string) ?? '';

        const result = await sendInputToAgentNode({
          workspaceId,
          nodeId,
          input: text,
        });

        if (!result.ok) {
          // Preserve the original tool's helpful guidance per error code,
          // so the agent gets the same hints it used to.
          switch (result.code) {
            case 'workspace_not_found':
              return 'Error: workspace not found';
            case 'node_not_found':
              return `Error: node not found: ${nodeId}`;
            case 'wrong_node_type':
              return `Error: canvas_send_to_agent only works on agent nodes. ${result.error}. ` +
                'For terminal nodes use the MCP `canvas_exec` tool; for file/frame nodes use `canvas_update_node`.';
            case 'not_running':
              return `Error: ${result.error}. ` +
                'The agent must have been launched (status="running") before you can send follow-up input. ' +
                'Create a new agent node with a prompt, or ask the user to launch this one.';
            case 'no_session':
              return `Error: ${result.error}. ` +
                'The agent node must be open in the canvas UI — closing or collapsing the node tears ' +
                'down its PTY. Ask the user to reopen the node, or relaunch the agent.';
            case 'write_failed':
              return `Error: ${result.error}.`;
          }
        }

        return JSON.stringify({
          ok: true,
          nodeId: result.nodeId,
          bytesSent: result.bytesSent,
        });
      },
    },
  };
}
