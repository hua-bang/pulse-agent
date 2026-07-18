import type { CanvasToolExecutionContext } from '../../agent/tools/types';
import type { CapabilityRuntime } from './runtime';

export async function executeCapabilityAsCanvasTool(
  runtime: CapabilityRuntime,
  name: string,
  workspaceId: string,
  input: unknown,
  toolContext?: CanvasToolExecutionContext,
): Promise<string> {
  const result = await runtime.call(name, input, {
    workspaceId,
    actor: { kind: 'canvas-agent' },
    abortSignal: toolContext?.abortSignal,
  });
  if (!result.ok) {
    return JSON.stringify({ ok: false, error: result.error.message });
  }
  const value = result.value && typeof result.value === 'object'
    ? result.value as Record<string, unknown>
    : { value: result.value };
  return JSON.stringify({ ok: true, ...value });
}
