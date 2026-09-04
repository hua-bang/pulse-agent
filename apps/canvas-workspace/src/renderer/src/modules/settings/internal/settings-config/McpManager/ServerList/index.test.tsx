// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ServerList } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MCP ServerList', () => {
  it('shows connection health and delegates editing a server', () => {
    const edit = vi.fn();
    const server = { name: 'research', transport: 'http' as const, url: 'https://mcp.example.com' };
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => {
      root.render(
        <ServerList
          view={{ servers: [server], statuses: { research: { ok: true, toolCount: 2 } }, oauthStatuses: {}, expanded: {}, busyTool: null, busyOAuth: null, busyReload: null }}
          actions={{ toggleExpanded: vi.fn(), reload: vi.fn(), connectOAuth: vi.fn(), disconnectOAuth: vi.fn(), edit, remove: vi.fn(), toggleTool: vi.fn() }}
          t={(key) => String(key)}
        />,
      );
    });
    expect(host.textContent).toContain('research');
    expect(host.textContent).toContain('mcpConfig.healthOk');
    act(() => { [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'mcpConfig.edit')?.click(); });
    expect(edit).toHaveBeenCalledWith(server);
    act(() => root.unmount());
  });
});
