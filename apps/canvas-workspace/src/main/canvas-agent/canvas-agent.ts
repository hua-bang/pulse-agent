/**
 * Canvas Agent — the workspace-scoped AI Copilot.
 *
 * Uses the Vercel AI SDK directly (not the engine) to run an agentic loop
 * with canvas-specific tools. Runs in the Electron main process.
 */

import { generateText, tool, stepCountIs, type ModelMessage, type Tool as AITool, type ToolSet } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { buildWorkspaceSummary, formatSummaryForPrompt } from './context-builder';
import { createCanvasTools } from './tools';
import { SessionStore } from './session-store';
import type { CanvasAgentConfig, CanvasAgentMessage, WorkspaceSummary } from './types';

// ─── System prompt ─────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are the Canvas Agent — the AI Copilot for this workspace.

## Your Role
You are the single AI entry point for this workspace. You can:
- Understand and explain everything on the canvas (files, terminals, agents, frames)
- Create, update, delete, and organize canvas nodes
- Read and write files directly
- Generate documents, PRDs, and technical specs

## Context Strategy
Your system prompt contains a summary of all canvas nodes. For detailed content:
- Use \`canvas_read_node\` to read a specific node's full content
- Use \`canvas_read_context\` with detail="full" for everything at once

## Canvas Tools
- \`canvas_read_context\`: Read workspace overview or full context
- \`canvas_read_node\`: Read a single node's content in detail
- \`canvas_create_node\`: Create new file/terminal/frame/agent nodes
- \`canvas_update_node\`: Update existing nodes (content, title, data)
- \`canvas_delete_node\`: Remove a node from the canvas
- \`canvas_move_node\`: Reposition a node

## Guidelines
- Be concise and direct
- When creating file nodes, give them meaningful titles
- When the user references a node by title, look it up in the summary below
- For canvas-related tasks, use the canvas_* tools

`;

function buildSystemPrompt(summary: WorkspaceSummary | null): string {
  if (!summary) {
    return BASE_SYSTEM_PROMPT + '\n## Current Canvas\n(empty workspace — no nodes yet)\n';
  }
  return BASE_SYSTEM_PROMPT + '\n## Current Canvas\n' + formatSummaryForPrompt(summary);
}

// ─── AI SDK tool adapter ───────────────────────────────────────────

function buildAITools(workspaceId: string): ToolSet {
  const rawTools = createCanvasTools(workspaceId);
  const aiTools: ToolSet = {};

  for (const [name, def] of Object.entries(rawTools)) {
    aiTools[name] = tool({
      description: def.description,
      inputSchema: z.object({}).passthrough(),
      execute: async (input: Record<string, unknown>) => {
        return await def.execute(input);
      },
    });
  }

  return aiTools;
}

// ─── Canvas Agent ──────────────────────────────────────────────────

export class CanvasAgent {
  private messages: ModelMessage[] = [];
  private sessionStore: SessionStore;
  private config: CanvasAgentConfig;
  private aiTools: ToolSet = {};

  constructor(config: CanvasAgentConfig) {
    this.config = config;
    this.sessionStore = new SessionStore(config.workspaceId);
  }

  async initialize(): Promise<void> {
    console.info(`[canvas-agent] Initializing for workspace: ${this.config.workspaceId}`);

    this.aiTools = buildAITools(this.config.workspaceId);

    // Start a new session
    await this.sessionStore.startSession();

    console.info('[canvas-agent] Initialized');
  }

  /**
   * Send a user message and get the agent's response.
   */
  async chat(message: string): Promise<string> {
    // Refresh workspace summary for system prompt
    const summary = await buildWorkspaceSummary(this.config.workspaceId);
    const systemPrompt = buildSystemPrompt(summary);

    // Add user message
    this.messages.push({ role: 'user', content: [{ type: 'text', text: message }] });
    this.sessionStore.addMessage({ role: 'user', content: message, timestamp: Date.now() });

    // Build the provider from env vars
    const provider = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_API_URL,
    });

    const model = this.config.model
      ?? process.env.OPENAI_MODEL
      ?? 'gpt-4o';

    const result = await generateText({
      model: provider(model),
      system: systemPrompt,
      messages: this.messages,
      tools: this.aiTools,
      stopWhen: stepCountIs(10),
    });

    const responseText = result.text || '(no response)';

    // Add assistant response
    this.messages.push({ role: 'assistant', content: [{ type: 'text', text: responseText }] });
    this.sessionStore.addMessage({ role: 'assistant', content: responseText, timestamp: Date.now() });

    return responseText;
  }

  /**
   * Get conversation history for the current session.
   */
  getHistory(): CanvasAgentMessage[] {
    return this.sessionStore.getMessages();
  }

  /**
   * Get the message count for the current session.
   */
  getMessageCount(): number {
    return this.sessionStore.getMessages().length;
  }

  /**
   * Destroy the agent (called when workspace is closed).
   */
  async destroy(): Promise<void> {
    console.info(`[canvas-agent] Destroying for workspace: ${this.config.workspaceId}`);
    await this.sessionStore.archiveSession();
    this.messages = [];
  }
}
