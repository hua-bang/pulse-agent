import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listRuntimeCapabilities: vi.fn(),
  callRuntimeCapability: vi.fn(),
}));

vi.mock('@pulse-coder/canvas-cli/core', () => mocks);

import { createCanvasRuntimeTools } from './canvas-runtime-tools';
import { createPulseCliTools } from './runtime-tools';

describe('Pulse CLI Canvas runtime tools', () => {
  beforeEach(() => {
    mocks.listRuntimeCapabilities.mockReset();
    mocks.callRuntimeCapability.mockReset();
  });

  it('keeps live-app tools out of the default Pulse CLI tool set', () => {
    expect(Object.keys(createPulseCliTools({}))).toEqual(['run_js']);
    expect(Object.keys(createPulseCliTools({
      PULSE_CODER_EXPERIMENTAL_APP_RUNTIME: '1',
    }))).toEqual([
      'run_js',
      'app_capabilities_list',
      'app_capability_call',
    ]);
  });

  it('exposes live capability discovery as a structured agent tool', async () => {
    mocks.listRuntimeCapabilities.mockResolvedValue({
      ok: true,
      value: [{
        name: 'browser.tabs.list',
        description: 'List tabs.',
        risk: 'read',
        inputSchema: { type: 'object', properties: {} },
      }],
    });
    const tools = createCanvasRuntimeTools();

    expect(Object.keys(tools)).toContain('app_capabilities_list');
    expect(JSON.parse(await tools.app_capabilities_list.execute({}))).toEqual({
      ok: true,
      capabilities: [{
        name: 'browser.tabs.list',
        description: 'List tabs.',
        risk: 'read',
        inputSchema: { type: 'object', properties: {} },
      }],
    });
  });

  it('forwards workspace-scoped calls and preserves runtime failures', async () => {
    mocks.callRuntimeCapability.mockResolvedValue({
      ok: false,
      error: { code: 'tab_not_found', message: 'Tab missing is not open.' },
    });
    const tools = createCanvasRuntimeTools();

    const output = JSON.parse(await tools.app_capability_call.execute({
      workspaceId: 'ws-1',
      name: 'browser.tabs.activate',
      input: { tabId: 'missing' },
    }));

    expect(mocks.callRuntimeCapability).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      name: 'browser.tabs.activate',
      input: { tabId: 'missing' },
    });
    expect(output).toEqual({
      ok: false,
      error: { code: 'tab_not_found', message: 'Tab missing is not open.' },
    });
  });
});
