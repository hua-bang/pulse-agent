import {
  callRuntimeCapability,
  listRuntimeCapabilities,
} from '@pulse-coder/canvas-cli/core';
import type { Tool } from 'pulse-coder-engine';
import { z } from 'zod';

export function createCanvasRuntimeTools(): Record<string, Tool> {
  return {
    app_capabilities_list: {
      name: 'app_capabilities_list',
      description:
        'List experimental capabilities exposed by a running Pulse Canvas application. ' +
        'Call this before app_capability_call to discover names and risk levels. ' +
        'Prefer these native tools over running equivalent pulse-canvas runtime shell commands.',
      inputSchema: z.object({}),
      execute: async () => {
        const result = await listRuntimeCapabilities();
        return JSON.stringify(result.ok
          ? { ok: true, capabilities: result.value }
          : result);
      },
    },
    app_capability_call: {
      name: 'app_capability_call',
      description:
        'Call one capability exposed by a running Pulse Canvas application. ' +
        'Requires an explicit workspaceId and a name returned by app_capabilities_list. ' +
        'Prefer this native tool over running an equivalent pulse-canvas runtime shell command.',
      inputSchema: z.object({
        workspaceId: z.string().min(1).describe('Target Canvas workspace ID.'),
        name: z.string().min(1).describe('Capability name returned by app_capabilities_list.'),
        input: z.record(z.string(), z.unknown()).optional().describe('Capability-specific input object.'),
      }),
      execute: async ({ workspaceId, name, input }) => {
        const result = await callRuntimeCapability({ workspaceId, name, input: input ?? {} });
        return JSON.stringify(result);
      },
    },
  };
}
