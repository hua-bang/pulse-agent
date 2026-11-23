export interface RemoteCapabilityDescriptor {
  name: string;
  description: string;
  risk: string;
  inputSchema: unknown;
}

export type RemoteCapabilityCallResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export interface RemoteCapabilityExecutor {
  list(): RemoteCapabilityDescriptor[];
  call(name: string, input: unknown, workspaceId: string): Promise<RemoteCapabilityCallResult>;
}

let executor: RemoteCapabilityExecutor | null = null;

export function setRemoteCapabilityExecutor(next: RemoteCapabilityExecutor | null): void {
  executor = next;
}

export function getRemoteCapabilityExecutor(): RemoteCapabilityExecutor | null {
  return executor;
}
