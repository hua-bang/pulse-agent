import { CapabilityRuntime } from './runtime';
import { createTabCapabilities } from './tab-capabilities';
import type { CapabilityActorKind, CapabilityRisk } from './types';

export * from './runtime';
export * from './types';
export * from './tab-capabilities';
export * from './agent-adapter';

let runtime: CapabilityRuntime | null = null;

const allowedRisks: Record<CapabilityActorKind, ReadonlySet<CapabilityRisk>> = {
  'canvas-agent': new Set(['read', 'operate', 'unsafe']),
  'pulse-cli': new Set(['read', 'operate']),
  test: new Set(['read', 'operate', 'unsafe']),
};

export function getCanvasCapabilityRuntime(): CapabilityRuntime {
  runtime ??= new CapabilityRuntime(
    createTabCapabilities(),
    (capability, actor) => allowedRisks[actor.kind].has(capability.risk),
  );
  return runtime;
}
