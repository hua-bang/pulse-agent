import { CapabilityRuntime } from './runtime';
import { createTabCapabilities } from './tab-capabilities';
import { createNodeCapabilities } from './node-capabilities';
import { createPageCapabilities } from './page-capabilities';
import { getExperimentalFlagSync } from '../../settings/experimental-ipc';
import { EXPERIMENTAL_FLAG_WEBVIEW_PAGE_CONTROL } from '../../../shared/experimental-features';
import type { CapabilityActorKind, CapabilityRisk } from './types';

export * from './runtime';
export * from './types';
export * from './tab-capabilities';
export * from './page-capabilities';
export * from './node-capabilities';
export * from './agent-adapter';

let runtime: CapabilityRuntime | null = null;

const allowedRisks: Record<CapabilityActorKind, ReadonlySet<CapabilityRisk>> = {
  'canvas-agent': new Set(['read', 'operate', 'unsafe']),
  'pulse-cli': new Set(['read', 'operate']),
  test: new Set(['read', 'operate', 'unsafe']),
};

const pageOperationCapabilities = new Set([
  'browser.page.click',
  'browser.page.fill',
  'browser.page.eval',
]);

export function getCanvasCapabilityRuntime(): CapabilityRuntime {
  runtime ??= new CapabilityRuntime(
    [
      ...createTabCapabilities(),
      ...createPageCapabilities(),
      ...createNodeCapabilities(),
    ],
    (capability, actor) => {
      if (!allowedRisks[actor.kind].has(capability.risk)) return false;
      return !pageOperationCapabilities.has(capability.name)
        || getExperimentalFlagSync(EXPERIMENTAL_FLAG_WEBVIEW_PAGE_CONTROL);
    },
  );
  return runtime;
}
