import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeCall = vi.hoisted(() => vi.fn());

vi.mock('../../runtime/capabilities', () => ({
  PAGE_READINESS_HINT: 'readiness hint',
  getCanvasCapabilityRuntime: () => ({ call: runtimeCall }),
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

import { createWebpageTools } from './webpage';

describe('canvas_read_webpage capability adapter', () => {
  beforeEach(() => runtimeCall.mockReset());

  it('preserves the legacy success payload', async () => {
    runtimeCall.mockResolvedValue({
      ok: true,
      value: {
        strategy: 'dom',
        title: 'Fixture',
        url: 'https://example.test/',
        text: 'hello',
        textLength: 5,
        hint: 'readiness hint',
      },
    });

    const output = JSON.parse(await createWebpageTools('ws-1').canvas_read_webpage.execute({
      nodeId: 'web-1',
      strategy: 'dom',
    }));
    expect(output).toEqual({
      ok: true,
      strategy: 'dom',
      title: 'Fixture',
      url: 'https://example.test/',
      text: 'hello',
      textLength: 5,
      hint: 'readiness hint',
    });
    expect(runtimeCall).toHaveBeenCalledWith(
      'browser.page.read',
      { nodeId: 'web-1', strategy: 'dom' },
      expect.objectContaining({ workspaceId: 'ws-1' }),
    );
  });

  it('uses the legacy workspace override without leaking it into capability input', async () => {
    runtimeCall.mockResolvedValue({ ok: true, value: { strategy: 'dom', text: '' } });

    await createWebpageTools('ws-1').canvas_read_webpage.execute({
      nodeId: 'web-1',
      workspaceId: 'ws-2',
      strategy: 'dom',
    });

    expect(runtimeCall).toHaveBeenCalledWith(
      'browser.page.read',
      { nodeId: 'web-1', strategy: 'dom' },
      expect.objectContaining({ workspaceId: 'ws-2' }),
    );
  });

  it('preserves strategy on read failures', async () => {
    runtimeCall.mockResolvedValue({
      ok: false,
      error: {
        code: 'page_read_failed',
        message: 'DOM extraction timed out',
        details: { strategy: 'dom' },
      },
    });

    const output = JSON.parse(await createWebpageTools('ws-1').canvas_read_webpage.execute({
      nodeId: 'web-1',
      strategy: 'dom',
    }));
    expect(output).toEqual({
      ok: false,
      strategy: 'dom',
      error: 'DOM extraction timed out',
    });
  });
});
