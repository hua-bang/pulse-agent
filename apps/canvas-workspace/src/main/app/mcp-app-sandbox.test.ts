import { describe, expect, it } from 'vitest';
import { createMcpAppSandboxResponse } from './mcp-app-sandbox';

describe('createMcpAppSandboxResponse', () => {
  it('serves a separate-origin proxy with a response-header CSP', async () => {
    const response = createMcpAppSandboxResponse(
      `pulse-mcp-app://sandbox/index.html?csp=${encodeURIComponent("default-src 'none'; frame-src 'self'")}`,
    );
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; frame-src 'self'");
    expect(await response.text()).toContain("event.origin === 'null'");
  });

  it('rejects header injection and falls back to the closed policy', () => {
    const response = createMcpAppSandboxResponse(
      'pulse-mcp-app://sandbox/index.html?csp=default-src%20*%0AX-Evil%3A%201',
    );
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
});
