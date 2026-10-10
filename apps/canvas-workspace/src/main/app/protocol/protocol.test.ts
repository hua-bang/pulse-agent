import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: { url: string }) => Promise<Response>>(),
  sandboxLoaded: vi.fn(),
  createResponse: vi.fn(() => new Response('<main>MCP App sandbox</main>')),
}));
vi.mock('electron', () => ({
  app: {}, net: {},
  protocol: { handle: (scheme: string, handler: (request: { url: string }) => Promise<Response>) => mocks.handlers.set(scheme, handler) },
}));
vi.mock('./mcp-app-sandbox', () => {
  mocks.sandboxLoaded();
  return { createMcpAppSandboxResponse: mocks.createResponse };
});
import { registerPulseCanvasProtocol } from './protocol';

describe('MCP App protocol lazy boundary', () => {
  it('registers immediately but loads the sandbox only for a valid App request', async () => {
    registerPulseCanvasProtocol(vi.fn(async () => undefined));
    const handler = mocks.handlers.get('pulse-mcp-app')!;
    expect(mocks.sandboxLoaded).not.toHaveBeenCalled();
    expect((await handler({ url: 'pulse-mcp-app://other/index.html' })).status).toBe(404);
    expect((await handler({ url: 'pulse-mcp-app://sandbox/other.html' })).status).toBe(404);
    expect(mocks.sandboxLoaded).not.toHaveBeenCalled();
    const url = 'pulse-mcp-app://sandbox/index.html?csp=closed-policy';
    expect(await (await handler({ url })).text()).toContain('MCP App sandbox');
    expect(mocks.sandboxLoaded).toHaveBeenCalledOnce();
    expect(mocks.createResponse).toHaveBeenCalledWith(url);
  });
});
