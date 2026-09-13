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

  it('delegates only clipboard writing to the opaque app without relaxing its sandbox', async () => {
    const html = await createMcpAppSandboxResponse('pulse-mcp-app://sandbox/index.html').text();
    expect(html).toContain("inner.setAttribute('allow', 'clipboard-write *')");
    expect(html).toContain("inner.setAttribute('sandbox', 'allow-scripts allow-forms')");
    expect(html).not.toContain('clipboard-read');
    expect(html).not.toContain('allow-same-origin');
  });

  it('rejects header injection and falls back to the closed policy', () => {
    const response = createMcpAppSandboxResponse(
      'pulse-mcp-app://sandbox/index.html?csp=default-src%20*%0AX-Evil%3A%201',
    );
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('injects an Escape relay into the opaque inner app document', async () => {
    const response = createMcpAppSandboxResponse('pulse-mcp-app://sandbox/index.html');
    const html = await response.text();
    expect(html).toContain("event.key==='Escape'");
    expect(html).toContain("type:'pulse-mcp-app-host-event'");
    expect(html).toContain("send('activate')");
    expect(html).toContain("installStorage('localStorage')");
    expect(html).toContain('Object.defineProperty(window,name');
  });
});
