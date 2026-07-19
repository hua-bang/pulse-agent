import { getCanvasCapabilityRuntime } from '../../../main/runtime/capabilities';
import { hostRendererEvalInputSchema } from '../../../main/runtime/capabilities/host-renderer-capabilities';
import type { CanvasTool } from '../../../main/agent/tools/types';

export function createHostRendererControlTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_host_eval: {
      name: 'canvas_host_eval',
      defer_loading: true,
      description:
        'Experimental: execute JavaScript in the Pulse Canvas host renderer UI. ' +
        'Use only when structured Canvas tools cannot express the requested host-UI operation. ' +
        'The script can use the renderer-exposed canvasWorkspace bridge and must return JSON-serialisable data.',
      inputSchema: hostRendererEvalInputSchema,
      execute: async (input, context) => {
        const result = await getCanvasCapabilityRuntime().call(
          'host.renderer.eval',
          input,
          {
            workspaceId,
            actor: { kind: 'canvas-agent' },
            abortSignal: context?.abortSignal,
          },
        );
        return JSON.stringify(result.ok
          ? { ok: true, ...(result.value as object) }
          : { ok: false, error: result.error.message, code: result.error.code });
      },
    },
  };
}
