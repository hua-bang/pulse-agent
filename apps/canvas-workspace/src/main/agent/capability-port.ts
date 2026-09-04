import type { CanvasToolExecutionContext } from './tools/types';

export type AgentCapabilityCallResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export interface AgentCapabilityPort {
  call: (
    name: string,
    input: unknown,
    context: {
      workspaceId: string;
      actor: { kind: 'canvas-agent' };
      abortSignal?: AbortSignal;
    },
  ) => Promise<AgentCapabilityCallResult>;
}

const unavailablePort: AgentCapabilityPort = {
  call: async (name) => ({
    ok: false,
    error: { code: 'capability_unavailable', message: `Capability runtime unavailable: ${name}` },
  }),
};
let capabilityPort = unavailablePort;

export function setAgentCapabilityPort(port: AgentCapabilityPort): void {
  capabilityPort = port;
}

export function getAgentCapabilityPort(): AgentCapabilityPort {
  return capabilityPort;
}

export async function executeCapabilityAsCanvasTool(
  name: string,
  workspaceId: string,
  input: unknown,
  toolContext?: CanvasToolExecutionContext,
): Promise<string> {
  const result = await capabilityPort.call(name, input, {
    workspaceId,
    actor: { kind: 'canvas-agent' },
    abortSignal: toolContext?.abortSignal,
  });
  if (!result.ok) return JSON.stringify({ ok: false, error: result.error.message });
  const value = result.value && typeof result.value === 'object'
    ? result.value as Record<string, unknown>
    : { value: result.value };
  return JSON.stringify({ ok: true, ...value });
}
