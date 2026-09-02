// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { buildMcpAppCsp } from '../../mcp-apps/McpAppFrame';
import { McpAppsProvider } from '../../mcp-apps/McpAppsProvider';
import { McpAppFrames } from '../ChatMessage/McpAppFrames';
import { RightDockProvider, useDockContext, useRightDockState } from '../../dock/RightDock/context';
import { DockPanes } from '../../dock/RightDock/DockPanes';
import { mcpAppDockHostElementId } from '../../dock/RightDock/dock-tab-ids';
import { I18nProvider } from '../../../i18n';

const bridgeState = vi.hoisted(() => ({ current: null as any }));
vi.mock('@modelcontextprotocol/ext-apps/app-bridge', () => ({
  PostMessageTransport: class {},
  AppBridge: class {
    onrequestdisplaymode?: (params: { mode: string }) => Promise<{ mode: string }>;
    oninitialized?: () => void;
    onsandboxready?: () => void;
    constructor() { bridgeState.current = this; }
    addEventListener() {}
    async connect() { this.oninitialized?.(); }
    async teardownResource() {}
    async close() {}
    setHostContext() {}
    async sendToolInput() {}
    async sendToolResult() {}
    async sendSandboxResourceReady() {}
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('buildMcpAppCsp', () => {
  it('denies undeclared network and frame access by default', () => {
    const csp = buildMcpAppCsp();
    expect(csp).toContain('connect-src data:');
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
    expect(csp).toContain('connect-src data: https://api.example.com');
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
        <I18nProvider><RightDockProvider><McpAppsProvider scope={{ kind: 'global' }}>
            <McpAppFrames instanceScope="test" tools={[{
              id: 1,
              name: 'mcp_demo_render',
              status: 'succeeded',
              mcpApp: {
                serverName: 'demo',
                toolName: 'render',
                resourceUri: 'ui://demo/app.html',
              },
            }]} />
        </McpAppsProvider></RightDockProvider></I18nProvider>,
      );
      await Promise.resolve();
    });
    const frame = document.body.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame?.getAttribute('src')).toContain('pulse-mcp-app://sandbox/index.html');
    await act(async () => { root.unmount(); });
  });

  it('moves the same iframe into a fullscreen Dock tab and restores it inline on close', async () => {
    const readResource = async () => ({
      ok: true,
      value: { contents: [{
        uri: 'ui://demo/app.html',
        mimeType: 'text/html;profile=mcp-app',
        text: '<main>Demo</main>',
      }] },
    });
    (window as any).canvasWorkspace = { agent: { mcpApps: { readResource } } };

    const DockHarness = () => {
      const { store, setMcpAppHost } = useDockContext();
      const state = useRightDockState();
      return <>
        <button type="button" data-close-app onClick={() => store.closeMcpApp('test:call-1')}>Close</button>
        <button type="button" data-open-other onClick={() => store.openChat()}>Other</button>
        <button type="button" data-reopen-app onClick={() => store.openMcpApp('test:call-1', 'render MCP App')}>App</button>
        <button type="button" data-focus-split-other onClick={() => {
          store.toggleSplitView();
          store.activate('chat');
        }}>Split other</button>
        <output data-active-tab>{state.activeTabId}</output>
        <DockPanes
          store={store}
          state={state}
          activePaneId={state.activeTabId}
          dockVisible={state.expanded}
          chatTabEnabled
          splitContentWidth={320}
          splitDividerWidth={6}
          onDividerMouseDown={() => undefined}
          setChatHost={() => undefined}
          setTerminalHost={() => undefined}
          setMcpAppHost={setMcpAppHost}
          terminalHostMounted={false}
          activeWorkspaceId="ws1"
          workspaces={[]}
          onOpenNodePage={() => undefined}
          pinUrlReference={() => undefined}
          onAddDomSelectionToChat={async () => ({ status: 'unavailable', target: null })}
        />
      </>;
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <I18nProvider><RightDockProvider>
          <McpAppsProvider scope={{ kind: 'global' }}>
            <McpAppFrames instanceScope="test" tools={[{
              id: 1,
              name: 'mcp_demo_render',
              toolCallId: 'call-1',
              status: 'succeeded',
              mcpApp: { serverName: 'demo', toolName: 'render', resourceUri: 'ui://demo/app.html' },
            }]} />
          </McpAppsProvider>
          <DockHarness />
        </RightDockProvider></I18nProvider>,
      );
      await Promise.resolve();
    });

    const frame = document.body.querySelector('iframe')!;
    const surface = frame.parentElement;
    expect(surface?.parentElement).toBe(document.body);
    await act(async () => { frame.dispatchEvent(new Event('load')); });
    await act(async () => {
      expect(await bridgeState.current.onrequestdisplaymode?.({ mode: 'fullscreen' }))
        .toEqual({ mode: 'fullscreen' });
    });
    expect(document.getElementById(mcpAppDockHostElementId('test:call-1'))).toBeTruthy();
    expect(frame.parentElement?.dataset.displayMode).toBe('fullscreen');
    expect(frame.parentElement).toBe(surface);
    expect(document.activeElement).toBe(frame);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-open-other]')?.click();
    });
    expect(frame.parentElement?.style.visibility).toBe('hidden');
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-reopen-app]')?.click();
    });
    expect(frame.parentElement?.style.visibility).not.toBe('hidden');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-focus-split-other]')?.click();
    });
    expect(host.querySelector('[data-active-tab]')?.textContent).toBe('chat');
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'pulse-mcp-app-host-event', action: 'activate' },
        source: frame.contentWindow,
      }));
    });
    expect(host.querySelector('[data-active-tab]')?.textContent).toBe('mcp-app:test%3Acall-1');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-close-app]')?.click();
    });
    expect(frame.parentElement?.dataset.displayMode).toBe('inline');
    expect(frame.parentElement).toBe(surface);
    expect(document.activeElement).toBe(document.body.querySelector('.chat-mcp-app__display-action'));

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('.chat-mcp-app__display-action')?.click();
    });
    expect(frame.parentElement?.dataset.displayMode).toBe('fullscreen');

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'pulse-mcp-app-host-event', action: 'escape' },
        source: frame.contentWindow,
      }));
    });
    expect(frame.parentElement?.dataset.displayMode).toBe('inline');
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('.chat-mcp-app__display-action')?.click();
    });

    await act(async () => {
      bridgeState.current.onrequestteardown?.();
    });
    expect(document.getElementById(mcpAppDockHostElementId('test:call-1'))).toBeNull();

    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('renders an in-app approval before executing an MCP App tool call', async () => {
    const callTool = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        approval: {
          requestId: 'approval-1',
          serverName: 'cowart',
          toolName: 'save_canvas',
          argumentsPreview: '{\n  "snapshot": "large"\n}',
          argumentsSize: 64_000,
          truncated: true,
        },
      })
      .mockResolvedValueOnce({ ok: true, value: { content: [], structuredContent: { saved: true } } });
    (window as any).canvasWorkspace = {
      agent: { mcpApps: {
        readResource: async () => ({
          ok: true,
          value: { contents: [{
            uri: 'ui://cowart/app.html',
            mimeType: 'text/html;profile=mcp-app',
            text: '<main>Cowart</main>',
          }] },
        }),
        callTool,
      } },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <I18nProvider><RightDockProvider><McpAppsProvider scope={{ kind: 'global' }}>
          <McpAppFrames instanceScope="approval" tools={[{
            id: 1,
            name: 'mcp_cowart_render',
            status: 'succeeded',
            mcpApp: { serverName: 'cowart', toolName: 'render', resourceUri: 'ui://cowart/app.html' },
          }]} />
        </McpAppsProvider></RightDockProvider></I18nProvider>,
      );
      await Promise.resolve();
    });
    const frame = document.body.querySelector('iframe')!;
    await act(async () => { frame.dispatchEvent(new Event('load')); });

    let resultPromise!: Promise<unknown>;
    await act(async () => {
      resultPromise = bridgeState.current.oncalltool({ name: 'save_canvas', arguments: { snapshot: 'large' } });
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('Allow this action?');
    expect(document.body.textContent).toContain('save_canvas');

    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent === 'Allow once')
        ?.click();
      await resultPromise;
    });
    expect(callTool).toHaveBeenNthCalledWith(2, { kind: 'global' }, 'cowart', 'save_canvas', {
      snapshot: 'large',
    }, {
      requestId: 'approval-1',
      decision: 'once',
    });
    await act(async () => { root.unmount(); });
    host.remove();
  });
});
