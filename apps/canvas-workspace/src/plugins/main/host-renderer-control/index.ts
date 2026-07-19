import type { MainCanvasPlugin } from '../../types';
import { getCanvasCapabilityRuntime } from '../../../main/runtime/capabilities';
import { createHostRendererCapabilities } from '../../../main/runtime/capabilities/host-renderer-capabilities';
import { getExperimentalFlagSync } from '../../../main/settings/experimental-ipc';
import { EXPERIMENTAL_FLAG_AGENT_RUNTIME_CONTROL } from '../../../shared/experimental-features';
import { createHostRendererControlTools } from './tools';

export const HostRendererControlPlugin: MainCanvasPlugin = {
  id: 'host-renderer-control',
  activate(ctx) {
    for (const capability of createHostRendererCapabilities()) {
      getCanvasCapabilityRuntime().register(capability);
    }
    ctx.registerCanvasTool((workspaceId) => (
      getExperimentalFlagSync(EXPERIMENTAL_FLAG_AGENT_RUNTIME_CONTROL)
        ? createHostRendererControlTools(workspaceId)
        : {}
    ));
  },
};
