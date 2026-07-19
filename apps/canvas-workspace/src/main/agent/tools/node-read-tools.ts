import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  buildDetailedContext,
  buildWorkspaceSummary,
  formatSummaryForPrompt,
} from '../context-builder';
import { getCanvasCapabilityRuntime } from '../../runtime/capabilities';
import type { CanvasTool } from './types';

export function createNodeReadTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_ask_user: {
      name: 'canvas_ask_user',
      description:
        'Ask the user a clarifying question and wait for their reply. Use this whenever you need more information, a choice between options, or confirmation before proceeding. Do NOT guess — ask.',
      inputSchema: z.object({
        question: z.string().describe('The question to ask the user. Be concise and specific.'),
        context: z.string().optional().describe('Optional extra context to help the user answer.'),
      }),
      execute: async (input, ctx) => {
        const ask = ctx?.onClarificationRequest;
        if (!ask) {
          return 'Clarification is not supported in this context. Proceed with best judgement.';
        }
        const signal = ctx?.abortSignal;
        const requestId = randomUUID();
        const askPromise = ask({
          id: requestId,
          question: input.question,
          context: input.context,
          timeout: 0,
        });
        if (!signal) return askPromise;
        return await new Promise<string>((resolve, reject) => {
          if (signal.aborted) {
            reject(new Error('Aborted'));
            return;
          }
          const onAbort = () => reject(new Error('Aborted'));
          signal.addEventListener('abort', onAbort, { once: true });
          askPromise.then(
            (answer) => {
              signal.removeEventListener('abort', onAbort);
              resolve(answer);
            },
            (err) => {
              signal.removeEventListener('abort', onAbort);
              reject(err);
            },
          );
        });
      },
    },

    canvas_read_context: {
      name: 'canvas_read_context',
      description:
        'Read a workspace context. Defaults to the current workspace; pass `workspaceId` to read a different canvas the user has `@`-mentioned. ' +
        'Use detail="summary" (default) for a quick overview of all nodes, or detail="full" to include file contents and terminal scrollback.',
      inputSchema: z.object({
        detail: z.enum(['summary', 'full']).optional().describe('Level of detail. "summary" returns node list with metadata. "full" includes file contents and terminal scrollback.'),
        workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace. Use this to read another canvas the user @-mentioned.'),
      }),
      execute: async (input) => {
        const detail = input.detail ?? 'summary';
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        if (detail === 'full') {
          const ctx = await buildDetailedContext(targetWorkspaceId);
          if (!ctx) return `Error: workspace not found: ${targetWorkspaceId}`;
          return JSON.stringify(ctx, null, 2);
        }
        const summary = await buildWorkspaceSummary(targetWorkspaceId);
        if (!summary) return `Error: workspace not found: ${targetWorkspaceId}`;
        return formatSummaryForPrompt(summary);
      },
    },

    canvas_read_node: {
      name: 'canvas_read_node',
      description:
        'Read the full content of a specific canvas node. For file nodes, returns the file content. For terminal/agent nodes, returns scrollback output. ' +
        'For iframe/link nodes, fetches the URL and returns the page text (HTML stripped, capped at ~200KB). ' +
        'For reference nodes (shells that mirror a node from another canvas), follows the reference and returns the SOURCE node\'s content, with `refNodeId`/`refWorkspaceId` pointing at the original. ' +
        'Defaults to the current workspace; pass `workspaceId` to read a node from another canvas the user `@`-mentioned.',
      inputSchema: z.object({
        nodeId: z.string().describe('The ID of the node to read.'),
        workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace.'),
      }),
      execute: async (input, context) => {
        const nodeId = input.nodeId as string;
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        const result = await getCanvasCapabilityRuntime().call(
          'canvas.nodes.read',
          { nodeId },
          {
            workspaceId: targetWorkspaceId,
            actor: { kind: 'canvas-agent' },
            abortSignal: context?.abortSignal,
          },
        );
        if (!result.ok) return `Error: ${result.error.message}`;
        return JSON.stringify(result.value, null, 2);
      },
    },
  };
}
