import { describe, expect, it, vi } from 'vitest';

const registerCapability = vi.hoisted(() => vi.fn());
const getExperimentalFlagSync = vi.hoisted(() => vi.fn());

vi.mock('../../../main/runtime/capabilities', () => ({
  getCanvasCapabilityRuntime: () => ({ register: registerCapability }),
}));
vi.mock('../../../main/settings/experimental-ipc', () => ({ getExperimentalFlagSync }));

import { HostRendererControlPlugin } from './index';

describe('HostRendererControlPlugin', () => {
  it('always registers the capability while the tool factory follows the live flag', () => {
    const registerCanvasTool = vi.fn();

    HostRendererControlPlugin.activate({ registerCanvasTool } as never);

    expect(registerCapability).toHaveBeenCalledWith(expect.objectContaining({
      name: 'host.renderer.eval',
      risk: 'unsafe',
    }));
    expect(registerCanvasTool).toHaveBeenCalledOnce();
    const factory = registerCanvasTool.mock.calls[0][0];
    getExperimentalFlagSync.mockReturnValue(false);
    expect(factory('ws-1')).toEqual({});
    getExperimentalFlagSync.mockReturnValue(true);
    expect(factory('ws-1')).toHaveProperty('canvas_host_eval');
  });
});
