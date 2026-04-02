#!/usr/bin/env node

/**
 * Team MCP Server
 *
 * Exposes agent-teams TaskList + Mailbox as MCP tools.
 * Each agent in a team connects to this server via MCP config.
 *
 * Usage:
 *   node mcp-server.js --state-dir /path/to/team-state --teammate-id researcher
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TaskList } from './task-list.js';
import { Mailbox } from './mailbox.js';

function parseArgs(args: string[]): { stateDir: string; teammateId: string } {
  let stateDir = '';
  let teammateId = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--state-dir' && args[i + 1]) {
      stateDir = args[++i];
    } else if (args[i] === '--teammate-id' && args[i + 1]) {
      teammateId = args[++i];
    }
  }

  if (!stateDir || !teammateId) {
    console.error('Usage: team-mcp-server --state-dir <path> --teammate-id <id>');
    process.exit(1);
  }

  return { stateDir, teammateId };
}

export function createTeamMCPServer(stateDir: string, teammateId: string): McpServer {
  const taskList = new TaskList(stateDir);
  const mailbox = new Mailbox(stateDir);

  const server = new McpServer({
    name: 'agent-team',
    version: '1.0.0',
  });

  // ─── Task Tools ──────────────────────────────────────────────

  server.tool(
    'team_claim_task',
    'Claim the next available task, or a specific task by ID. Returns the claimed task details.',
    { taskId: z.string().optional().describe('Specific task ID to claim, or omit for auto-claim') },
    async ({ taskId }) => {
      const task = await taskList.claim(teammateId, taskId);
      if (!task) {
        return { content: [{ type: 'text' as const, text: 'No claimable task available.' }] };
      }
      return {
        content: [{
          type: 'text' as const,
          text: `Claimed task: ${task.title} (id: ${task.id})\nDescription: ${task.description}`,
        }],
      };
    },
  );

  server.tool(
    'team_complete_task',
    'Mark a task as completed with a result summary.',
    {
      taskId: z.string().describe('Task ID to complete'),
      result: z.string().optional().describe('Task result or summary'),
    },
    async ({ taskId, result }) => {
      const task = await taskList.complete(taskId, result);
      if (!task) {
        return { content: [{ type: 'text' as const, text: 'Task not found or not in progress.' }] };
      }
      return { content: [{ type: 'text' as const, text: `Task completed: ${task.title}` }] };
    },
  );

  server.tool(
    'team_fail_task',
    'Mark a task as failed with an error description.',
    {
      taskId: z.string().describe('Task ID to fail'),
      error: z.string().optional().describe('Error description'),
    },
    async ({ taskId, error }) => {
      const task = await taskList.fail(taskId, error);
      if (!task) {
        return { content: [{ type: 'text' as const, text: 'Task not found or not in progress.' }] };
      }
      return { content: [{ type: 'text' as const, text: `Task failed: ${task.title}` }] };
    },
  );

  server.tool(
    'team_create_task',
    'Create a new task in the shared task list.',
    {
      title: z.string().describe('Short task title'),
      description: z.string().describe('Detailed description'),
      deps: z.array(z.string()).optional().describe('IDs of dependency tasks'),
      assignee: z.string().optional().describe('Teammate ID to assign to'),
    },
    async ({ title, description, deps, assignee }) => {
      const task = await taskList.create({ title, description, deps, assignee }, teammateId);
      return { content: [{ type: 'text' as const, text: `Task created: ${task.title} (id: ${task.id})` }] };
    },
  );

  server.tool(
    'team_list_tasks',
    'List all tasks in the shared task list with their status and assignee.',
    {},
    async () => {
      const tasks = taskList.getAll();
      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No tasks.' }] };
      }
      const text = tasks.map(t =>
        `[${t.status}] ${t.title} (id: ${t.id}, assignee: ${t.assignee || 'none'}${t.deps.length > 0 ? `, deps: ${t.deps.join(', ')}` : ''})`
      ).join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // ─── Message Tools ───────────────────────────────────────────

  server.tool(
    'team_send_message',
    'Send a message to another teammate by their ID.',
    {
      to: z.string().describe('Recipient teammate ID'),
      content: z.string().describe('Message content'),
    },
    async ({ to, content }) => {
      const msg = mailbox.send(teammateId, to, 'message', content);
      return { content: [{ type: 'text' as const, text: `Message sent to ${to} (id: ${msg.id})` }] };
    },
  );

  server.tool(
    'team_read_messages',
    'Read unread messages from the team mailbox.',
    {},
    async () => {
      const messages = mailbox.readUnread(teammateId);
      if (messages.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No unread messages.' }] };
      }
      const text = messages.map(m =>
        `[from: ${m.from}] (${m.type}) ${m.content}`
      ).join('\n---\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'team_notify_lead',
    'Send a message to the team lead (e.g. to report findings, ask questions, or signal completion).',
    {
      content: z.string().describe('Message to the lead'),
    },
    async ({ content }) => {
      mailbox.send(teammateId, 'lead', 'message', content);
      return { content: [{ type: 'text' as const, text: 'Message sent to lead.' }] };
    },
  );

  server.tool(
    'team_submit_plan',
    'Submit your implementation plan to the lead for approval. Use this when in plan mode.',
    {
      plan: z.string().describe('Your detailed implementation plan'),
    },
    async ({ plan }) => {
      mailbox.send(teammateId, 'lead', 'plan_approval_request', plan);
      return { content: [{ type: 'text' as const, text: 'Plan submitted to lead for approval. Waiting for response...' }] };
    },
  );

  return server;
}

// ─── CLI Entry Point ─────────────────────────────────────────

const isDirectRun = process.argv[1]?.endsWith('mcp-server.js') ||
                    process.argv[1]?.endsWith('mcp-server');

if (isDirectRun) {
  const { stateDir, teammateId } = parseArgs(process.argv.slice(2));
  const server = createTeamMCPServer(stateDir, teammateId);
  const transport = new StdioServerTransport();
  void server.connect(transport);
}
