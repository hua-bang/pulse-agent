import { describe, expect, it, vi } from 'vitest';

import { CapabilityRuntime } from './runtime';
import { createPageCapabilities } from './page-capabilities';

describe('Page capabilities', () => {
  it('reads a live page with workspace context through the public runtime seam', async () => {
    const readPage = vi.fn().mockResolvedValue({
      strategy: 'dom',
      title: 'Runtime fixture',
      url: 'https://example.test/',
      text: 'hello',
      textLength: 5,
      hint: 'verify readiness',
    });
    const runtime = new CapabilityRuntime(createPageCapabilities({
      readPage,
      clickPage: vi.fn(),
      fillPage: vi.fn(),
      evalPage: vi.fn(),
    }));

    await expect(runtime.call(
      'browser.page.read',
      { nodeId: 'web-1', strategy: 'dom' },
      { workspaceId: 'ws-1', actor: { kind: 'test' } },
    )).resolves.toEqual({
      ok: true,
      value: {
        strategy: 'dom',
        title: 'Runtime fixture',
        url: 'https://example.test/',
        text: 'hello',
        textLength: 5,
        hint: 'verify readiness',
      },
    });
    expect(readPage).toHaveBeenCalledWith('ws-1', {
      nodeId: 'web-1',
      strategy: 'dom',
    });
  });

  it('exposes structured click and fill schemas and delegates validated actions', async () => {
    const clickPage = vi.fn().mockResolvedValue({
      action: 'page_click',
      url: 'https://example.test/',
      selector: '#submit',
    });
    const fillPage = vi.fn().mockResolvedValue({
      action: 'page_fill',
      url: 'https://example.test/',
      selector: '#name',
      value: 'Pulse',
    });
    const runtime = new CapabilityRuntime(createPageCapabilities({
      readPage: vi.fn(),
      clickPage,
      fillPage,
      evalPage: vi.fn(),
    }));
    const context = { workspaceId: 'ws-1', actor: { kind: 'test' as const } };

    await expect(runtime.call(
      'browser.page.click',
      { nodeId: 'web-1', selector: '#submit' },
      context,
    )).resolves.toMatchObject({ ok: true, value: { action: 'page_click' } });
    await expect(runtime.call(
      'browser.page.fill',
      { nodeId: 'web-1', selector: '#name', value: 'Pulse' },
      context,
    )).resolves.toMatchObject({ ok: true, value: { action: 'page_fill' } });

    expect(clickPage).toHaveBeenCalledWith('ws-1', {
      nodeId: 'web-1',
      selector: '#submit',
    });
    expect(fillPage).toHaveBeenCalledWith('ws-1', {
      nodeId: 'web-1',
      selector: '#name',
      value: 'Pulse',
    });
    expect(runtime.list({ kind: 'test' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'browser.page.click', risk: 'operate' }),
      expect.objectContaining({ name: 'browser.page.fill', risk: 'operate' }),
    ]));
  });

  it('lets the Canvas Agent execute unsafe page scripts through the runtime seam', async () => {
    const evalPage = vi.fn().mockResolvedValue({
      action: 'page_eval',
      url: 'https://example.test/',
      value: { count: 3 },
    });
    const runtime = new CapabilityRuntime(createPageCapabilities({
      readPage: vi.fn(),
      clickPage: vi.fn(),
      fillPage: vi.fn(),
      evalPage,
    }));

    expect(runtime.list({ kind: 'canvas-agent' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'browser.page.eval', risk: 'unsafe' }),
    ]));
    await expect(runtime.call(
      'browser.page.eval',
      { nodeId: 'web-1', code: 'return { count: document.links.length }', timeoutMs: 2_000 },
      { workspaceId: 'ws-1', actor: { kind: 'canvas-agent' } },
    )).resolves.toEqual({
      ok: true,
      value: {
        action: 'page_eval',
        url: 'https://example.test/',
        value: { count: 3 },
      },
    });
    expect(evalPage).toHaveBeenCalledWith('ws-1', {
      nodeId: 'web-1',
      code: 'return { count: document.links.length }',
      timeoutMs: 2_000,
    });
  });

  it('can hide operate capabilities when webview page control is disabled', () => {
    const runtime = new CapabilityRuntime(createPageCapabilities({
      readPage: vi.fn(),
      clickPage: vi.fn(),
      fillPage: vi.fn(),
      evalPage: vi.fn(),
    }, { includePageControl: false }));

    expect(runtime.list({ kind: 'pulse-cli' }).map(({ name }) => name)).toEqual([
      'browser.page.read',
    ]);
  });
});
