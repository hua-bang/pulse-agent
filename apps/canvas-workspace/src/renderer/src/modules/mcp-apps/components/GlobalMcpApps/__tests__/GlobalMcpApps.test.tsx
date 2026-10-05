// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalMcpAppsView } from '../GlobalMcpAppsView';
import { GlobalMcpAppsStore, globalMcpAppKey, globalMcpAppsStore } from '../globalMcpAppsStore';
import { RightDockProvider } from '../../../../dock/internal/RightDock/context';
import { I18nProvider } from '../../../../../i18n';
import type { McpAppEntrypointListing } from '../../../../../../../shared/mcp-apps';

vi.mock('@modelcontextprotocol/ext-apps/app-bridge', () => ({
  PostMessageTransport: class {},
  AppBridge: class {
    addEventListener() {}
    async connect() {}
    async teardownResource() {}
    async close() {}
    setHostContext() {}
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listing = (toolName: string, kind: McpAppEntrypointListing['kind'] = 'global'): McpAppEntrypointListing => ({
  serverName: 'mock-apps',
  toolName,
  resourceUri: `ui://mock/${toolName}`,
  title: toolName,
  kind,
});

const parts = listing('parts');
const board = listing('board');

let host: HTMLDivElement;
let root: Root;
let openEntrypoint: ReturnType<typeof vi.fn>;

const render = (active: { serverName: string; toolName: string } | null, onCloseActive = vi.fn()) => (
  act(async () => {
    root.render(
      <I18nProvider><RightDockProvider>
        <GlobalMcpAppsView active={active} onCloseActive={onCloseActive} />
      </RightDockProvider></I18nProvider>,
    );
  })
);

const pane = (key: string) => host.querySelector<HTMLElement>(`[data-mcp-app-key="${CSS.escape(key)}"]`);

beforeEach(() => {
  openEntrypoint = vi.fn().mockResolvedValue({ ok: true, value: { content: [] } });
  (window as any).canvasWorkspace = { agent: { mcpApps: {
    openEntrypoint,
    listEntrypoints: vi.fn().mockResolvedValue({
      ok: true, value: [parts, board, listing('notes', 'thread'), listing('widget', 'node')],
    }),
    readResource: vi.fn().mockResolvedValue({ ok: true, value: { contents: [{
      mimeType: 'text/html;profile=mcp-app', text: '<main>App</main>',
    }] } }),
  } } };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  for (const app of globalMcpAppsStore.getSnapshot().running) globalMcpAppsStore.close(app.key);
});

describe('GlobalMcpAppsStore', () => {
  it('lists only global entrypoints and keeps one instance per tool', async () => {
    const store = new GlobalMcpAppsStore();
    await store.refresh();
    expect(store.getSnapshot().listings.map(item => item.toolName)).toEqual(['parts', 'board']);

    store.open(parts);
    store.open(parts);
    store.reload(globalMcpAppKey(parts));
    expect(store.getSnapshot().running).toEqual([{ key: globalMcpAppKey(parts), listing: parts, revision: 1 }]);

    store.close(globalMcpAppKey(parts));
    expect(store.getSnapshot().running).toEqual([]);
  });
});

describe('GlobalMcpAppsView', () => {
  it('keeps every opened app mounted while switching between them and other views', async () => {
    globalMcpAppsStore.open(parts);
    await render(parts);
    globalMcpAppsStore.open(board);
    await render(board);
    const partsFrame = pane(globalMcpAppKey(parts))?.querySelector('iframe');
    expect(partsFrame).toBeTruthy();
    expect(pane(globalMcpAppKey(parts))?.hidden).toBe(true);
    expect(pane(globalMcpAppKey(board))?.hidden).toBe(false);

    await render(null);
    await render(parts);
    expect(pane(globalMcpAppKey(parts))?.querySelector('iframe')).toBe(partsFrame);
    expect(pane(globalMcpAppKey(parts))?.hidden).toBe(false);
    expect(openEntrypoint).toHaveBeenCalledTimes(2);
    expect(openEntrypoint).toHaveBeenCalledWith({ kind: 'global' }, 'mock-apps', 'parts');
  });

  it('opens an app named by the route and leaves the route when the active app closes', async () => {
    await globalMcpAppsStore.refresh();
    const onCloseActive = vi.fn();
    await render(board, onCloseActive);
    expect(globalMcpAppsStore.getSnapshot().running.map(app => app.key)).toEqual([globalMcpAppKey(board)]);

    const close = pane(globalMcpAppKey(board))!.querySelector<HTMLButtonElement>('button[aria-label="Close app"]')!;
    await act(async () => close.click());
    expect(onCloseActive).toHaveBeenCalledTimes(1);
    expect(globalMcpAppsStore.getSnapshot().running).toEqual([]);
  });
});
