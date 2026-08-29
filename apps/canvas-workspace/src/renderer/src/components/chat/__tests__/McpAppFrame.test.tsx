// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { buildMcpAppCsp, McpAppFrames } from '../McpAppFrame';
import { McpAppsProvider } from '../McpAppsContext';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('buildMcpAppCsp', () => {
  it('denies undeclared network and frame access by default', () => {
    const csp = buildMcpAppCsp();
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("form-action 'none'");
  });

  it('allows only valid domains declared by MCP Apps resource metadata', () => {
    const csp = buildMcpAppCsp({
      ui: {
        csp: {
          connectDomains: ['https://api.example.com', 'https://bad.example/x'],
          resourceDomains: ['https://cdn.example.com'],
        },
      },
    });
    expect(csp).toContain('connect-src https://api.example.com');
    expect(csp).toContain('https://cdn.example.com');
    expect(csp).not.toContain('https://bad.example/x');
  });

  it('loads a ui resource into an inline sandboxed iframe', async () => {
    const readResource = async () => ({
      ok: true,
      value: { contents: [{
        uri: 'ui://demo/app.html',
        mimeType: 'text/html;profile=mcp-app',
        text: '<main>Demo</main>',
      }] },
    });
    (window as any).canvasWorkspace = {
      agent: { mcpApps: { readResource } },
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <McpAppsProvider scope={{ kind: 'global' }}>
          <McpAppFrames tools={[{
            id: 1,
            name: 'mcp_demo_render',
            status: 'succeeded',
            mcpApp: {
              serverName: 'demo',
              toolName: 'render',
              resourceUri: 'ui://demo/app.html',
            },
          }]} />
        </McpAppsProvider>,
      );
      await Promise.resolve();
    });
    const frame = host.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame?.getAttribute('src')).toContain('pulse-mcp-app://sandbox/index.html');
    await act(async () => { root.unmount(); });
  });
});
