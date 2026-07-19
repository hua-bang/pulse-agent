import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeCall = vi.hoisted(() => vi.fn());

vi.mock('../../../../main/runtime/capabilities', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../main/runtime/capabilities')>(),
  getCanvasCapabilityRuntime: () => ({ call: runtimeCall }),
}));

import { createWebviewPageControlTools } from '../tools';

describe('page-control capability adapters', () => {
  beforeEach(() => runtimeCall.mockReset());

  it('preserves the existing page_eval input contract', () => {
    const schema = createWebviewPageControlTools('ws-1').page_eval.inputSchema;
    expect(schema.safeParse({ nodeId: '', code: '', timeoutMs: 60_000 }).success).toBe(true);
  });

  it('routes page_eval through the unsafe runtime capability', async () => {
    runtimeCall.mockResolvedValue({
      ok: true,
      value: {
        action: 'page_eval',
        url: 'https://example.test/',
        value: { count: 3 },
      },
    });

    const output = JSON.parse(await createWebviewPageControlTools('ws-1').page_eval.execute({
      nodeId: 'web-1',
      code: 'return { count: document.links.length }',
    }));
    expect(runtimeCall).toHaveBeenCalledWith(
      'browser.page.eval',
      {
        nodeId: 'web-1',
        code: 'return { count: document.links.length }',
      },
      expect.objectContaining({
        workspaceId: 'ws-1',
        actor: { kind: 'canvas-agent' },
      }),
    );
    expect(output).toEqual({
      ok: true,
      action: 'page_eval',
      url: 'https://example.test/',
      value: { count: 3 },
    });
  });

  it('preserves page_click success output', async () => {
    runtimeCall.mockResolvedValue({
      ok: true,
      value: {
        action: 'page_click',
        url: 'https://example.test/',
        selector: '#submit',
      },
    });

    const output = JSON.parse(await createWebviewPageControlTools('ws-1').page_click.execute({
      nodeId: 'web-1',
      selector: '#submit',
    }));
    expect(output).toEqual({
      ok: true,
      action: 'page_click',
      url: 'https://example.test/',
      selector: '#submit',
    });
  });

  it('preserves page_fill structured failures', async () => {
    runtimeCall.mockResolvedValue({
      ok: false,
      error: {
        code: 'page_action_failed',
        message: 'selector not found',
        details: {
          action: 'page_fill',
          url: 'https://example.test/',
          timedOut: true,
        },
      },
    });

    const output = JSON.parse(await createWebviewPageControlTools('ws-1').page_fill.execute({
      nodeId: 'web-1',
      selector: '#name',
      value: 'Pulse',
    }));
    expect(output).toEqual({
      ok: false,
      action: 'page_fill',
      url: 'https://example.test/',
      error: 'selector not found',
      timedOut: true,
    });
  });
});
