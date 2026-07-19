import type { z } from 'zod';

export type CapabilityRisk = 'read' | 'operate' | 'unsafe';

export type CapabilityActorKind =
  | 'canvas-agent'
  | 'pulse-cli'
  | 'test';

export interface CapabilityActor {
  kind: CapabilityActorKind;
}

export interface CapabilityContext {
  workspaceId: string;
  actor: CapabilityActor;
  abortSignal?: AbortSignal;
}

export interface CapabilityDescriptor {
  name: string;
  description: string;
  risk: CapabilityRisk;
  inputSchema: unknown;
}

export interface CapabilityFailure {
  code: string;
  message: string;
  details?: unknown;
}

export type CapabilityCallResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: CapabilityFailure };

export interface CapabilityDefinition<Input = unknown, Output = unknown>
  extends CapabilityDescriptor {
  inputSchema: z.ZodType<Input>;
  execute: (input: Input, context: CapabilityContext) => Promise<Output>;
}

export type AnyCapabilityDefinition = CapabilityDefinition<any, unknown>;

export type CapabilityPolicy = (
  capability: CapabilityDescriptor,
  actor: CapabilityActor,
) => boolean;

export class CapabilityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CapabilityError';
  }
}
