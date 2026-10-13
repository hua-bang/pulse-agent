// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppsSection } from '../AppsSection';
import { I18nProvider } from '../../../../i18n';
import { globalMcpAppKey, globalMcpAppsStore } from '../../../../modules/mcp-apps/global-apps';
import type { McpAppEntrypointListing } from '../../../../../../shared/mcp-apps';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listing = (toolName: string, kind: McpAppEntrypointListing['kind']): McpAppEntrypointListing => ({
  serverName: 'mock-apps',
  toolName,
  resourceUri: `ui://mock/${toolName}`,
  title: `App ${toolName}`,
  kind,
});
const parts = listing('parts', 'global');
const SVG_ICON = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';

let host: HTMLDivElement;
let root: Root;
let onOpenApp: ReturnType<typeof vi.fn>;

const render = (activeAppKey: string | null = null) => act(async () => {
  root.render(
    <I18nProvider>
      <AppsSection activeView="canvas" activeAppKey={activeAppKey} onOpenApp={onOpenApp} />
    </I18nProvider>,
  );
});

beforeEach(() => {
  (window as any).canvasWorkspace = { agent: { mcpApps: {
    listEntrypoints: vi.fn().mockResolvedValue({
      ok: true, value: [parts, listing('notes', 'thread'), listing('widget', 'node')],
    }),
  } } };
  onOpenApp = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  for (const app of globalMcpAppsStore.getSnapshot().running) globalMcpAppsStore.close(app.key);
});

describe('Sidebar AppsSection', () => {
  it('shows only global apps on the rail, marks the active one, and opens on click', async () => {
    globalMcpAppsStore.open(parts);
    await render(globalMcpAppKey(parts));

    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.sidebar-apps-rail__btn')];
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['App parts']);
    expect(buttons[0].className).toContain('sidebar-rail-btn--active');
    expect(buttons[0].querySelector('.global-mcp-app-tile')?.textContent).toBe('A');

    await act(async () => buttons[0].click());
    expect(onOpenApp).toHaveBeenCalledWith(parts);
  });

  it('paints a declared monochrome icon with the current text color', async () => {
    (window as any).canvasWorkspace.agent.mcpApps.listEntrypoints.mockResolvedValue({
      ok: true, value: [{ ...parts, icon: { default: { kind: 'mask', src: SVG_ICON } } }],
    });
    await render();
    const mask = host.querySelector<HTMLElement>('.sidebar-apps-rail__btn .global-mcp-app-icon__mask');
    expect(mask?.style.maskImage || mask?.style.getPropertyValue('-webkit-mask-image')).toContain(SVG_ICON);
    expect(host.querySelector('.sidebar-apps-rail__btn .global-mcp-app-tile')).toBeNull();
  });
});
