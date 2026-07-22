import { z } from 'zod';

import type { AnyCapabilityDefinition } from './types';

export const canvasAgentChatInputSchema = z.object({
  message: z.string().trim().min(1).max(32_000).describe('Message to submit to the Canvas Agent chat.'),
  sender: z.object({
    agentType: z.enum(['claude-code', 'codex']).describe('Curated coding-agent icon to display.'),
    label: z.string().trim().min(1).max(80).describe('Human-readable name for this coding-agent instance.'),
  }).strict(),
}).strict();

export type CanvasAgentChatInput = z.infer<typeof canvasAgentChatInputSchema>;

export function createChatCapabilities(): AnyCapabilityDefinition[] {
  return [{
    name: 'canvas.agent.chat',
    description: 'Submit a labelled coding-agent message to the visible Canvas Agent chat.',
    risk: 'operate',
    inputSchema: canvasAgentChatInputSchema,
    execute: async (input, context) => (
      await import('./chat-execution')
    ).executeExternalChat(input, context),
  }];
}
