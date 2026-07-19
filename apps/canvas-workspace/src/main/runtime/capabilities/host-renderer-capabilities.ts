import { z } from 'zod';

import type { AnyCapabilityDefinition } from './types';

const MAX_TIMEOUT_MS = 30_000;

export const hostRendererEvalInputSchema = z.object({
  code: z.string().min(1).max(100_000).describe(
    'JavaScript function body for the Pulse Canvas host renderer. Use return for output.',
  ),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional().describe(
    'Result timeout in milliseconds. Defaults to 5000.',
  ),
});

export type HostRendererEvalInput = z.infer<typeof hostRendererEvalInputSchema>;

export function createHostRendererCapabilities(): AnyCapabilityDefinition[] {
  return [{
    name: 'host.renderer.eval',
    description: 'Run JavaScript in the selected Pulse Canvas host renderer. Experimental.',
    risk: 'unsafe',
    inputSchema: hostRendererEvalInputSchema,
    execute: async (input, context) => (
      await import('./host-renderer-execution')
    ).executeHostRendererEval(input, context),
  }];
}
