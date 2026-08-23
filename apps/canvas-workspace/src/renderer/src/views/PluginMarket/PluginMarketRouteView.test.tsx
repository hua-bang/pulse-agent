// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  PluginMarketApi,
  PluginMarketListing,
  PluginMarketSnapshot,
} from '../../../../shared/plugin-market';
import type { ShellApi } from '../../types/shell';
import { PluginMarketRouteView } from './PluginMarketRouteView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params?.name) return `${key}:${params.name}`;
      if (params?.count !== undefined) return `${key}:${params.count}`;
      return key;
    },
  }),
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const listing = (overrides: Partial<PluginMarketListing> = {}): PluginMarketListing => ({
  id: 'computer-use',
  name: 'Computer Use',
  description: 'Control local apps from Pulse Canvas.',
  version: '1.2.3',
  author: { name: 'Pulse' },
  category: 'Productivity',
  featured: true,
  visibility: 'public',
  sourceFormat: 'agent-plugin',
  source: { kind: 'git', url: 'https://github.com/pulse/computer-use' },
  iconKey: 'browser',
  capabilities: { skillCount: 2, mcpServerCount: 1, hasPulseExtension: true },
  installState: 'available',
  ...overrides,
});

const snapshot = (listings: PluginMarketListing[]): PluginMarketSnapshot => ({
  listings,
  updatedAt: 1,
});

const createApi = (initial: PluginMarketSnapshot): PluginMarketApi => ({
  list: vi.fn(async () => ({ ok: true, snapshot: initial })),
  refresh: vi.fn(async () => ({ ok: true, snapshot: initial })),
  install: vi.fn(async () => ({ ok: true, snapshot: initial })),
  uninstall: vi.fn(async () => ({ ok: true, snapshot: initial })),
  connectMcp: vi.fn(async () => ({ ok: true, snapshot: initial })),
  setNativeEnabled: vi.fn(async () => ({ ok: true, snapshot: initial })),
  chooseDirectory: vi.fn(async () => ({ ok: true, snapshot: initial })),
  addGit: vi.fn(async () => ({ ok: true, snapshot: initial })),
});

const render = async (
  api: PluginMarketApi,
  openExternal: ShellApi['openExternal'] = vi.fn(async () => ({ ok: true })),
) => {
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: { pluginMarket: api, shell: { openExternal } },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <PluginMarketRouteView onNavigateSkills={vi.fn()} onOpenSettings={vi.fn()} />,
    );
  });
};

afterEach(() => {
  act(() => root?.unmount());
  document.querySelectorAll('.ui-modal-backdrop').forEach((element) => element.remove());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe('PluginMarketRouteView', () => {
  it('loads the real market snapshot and filters the catalog search', async () => {
    const installed = listing({
      id: 'github',
      name: 'GitHub',
      featured: false,
      installState: 'installed',
      iconKey: 'github',
    });
    await render(createApi(snapshot([listing(), installed])));

    expect(host?.querySelector('[data-plugin-id="computer-use"]')).not.toBeNull();
    expect(host?.querySelector('[data-plugin-id="github"]')).not.toBeNull();
    expect(host?.querySelectorAll('.plugin-market__installed-button')).toHaveLength(1);
    expect(host?.querySelector('[data-plugin-id="computer-use"]')?.textContent)
      .not.toContain('pluginMarket.sourceAgentPlugin');

    const search = host?.querySelector<HTMLInputElement>('input[type="search"]');
    await act(async () => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        ?.set?.call(search, 'github');
      search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });

    expect(host?.querySelector('[data-plugin-id="computer-use"]')).toBeNull();
    expect(host?.querySelector('[data-plugin-id="github"]')).not.toBeNull();
  });

  it('surfaces catalog failures and retries through the refresh API', async () => {
    const api = createApi(snapshot([listing()]));
    vi.mocked(api.list).mockResolvedValue({ ok: false, error: 'Catalog offline' });
    await render(api);

    expect(host?.querySelector('.plugin-market__state')?.textContent)
      .toContain('Catalog offline');
    const retry = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.includes('pluginMarket.retry'));
    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });

    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(host?.querySelector('[data-plugin-id="computer-use"]')).not.toBeNull();
  });

  it('installs an available listing and adopts the returned snapshot', async () => {
    const available = listing();
    const installed = listing({ installState: 'installed' });
    const api = createApi(snapshot([available]));
    vi.mocked(api.install).mockResolvedValue({ ok: true, snapshot: snapshot([installed]) });
    await render(api);

    const installButton = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.includes('pluginMarket.install'));
    await act(async () => {
      installButton?.click();
      await Promise.resolve();
    });

    expect(api.install).toHaveBeenCalledWith('computer-use');
    expect(host?.querySelectorAll('.plugin-market__installed-button')).toHaveLength(1);
  });

  it('renders curated brand artwork and license metadata', async () => {
    await render(createApi(snapshot([listing({
      id: 'exa',
      name: 'Exa',
      iconKey: 'exa',
      license: 'MIT',
    })])));

    expect(host?.querySelector('[data-plugin-id="exa"] .plugin-market__glyph img')).not.toBeNull();
    act(() => host?.querySelector<HTMLButtonElement>('.plugin-market__listing-main')?.click());
    expect(document.querySelector('.plugin-market-detail__metadata')?.textContent)
      .toContain('MIT');
  });

  it('opens unsupported Git listings from both the row and detail view', async () => {
    const unsupported = listing({ installState: 'unsupported' });
    const openExternal = vi.fn(async () => ({ ok: true }));
    await render(createApi(snapshot([unsupported])), openExternal);

    const rowExplore = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.includes('pluginMarket.explore'));
    await act(async () => {
      rowExplore?.click();
      await Promise.resolve();
    });

    act(() => host?.querySelector<HTMLButtonElement>('.plugin-market__listing-main')?.click());
    const detailExplore = [...document.querySelectorAll<HTMLButtonElement>('.plugin-market-modal button')]
      .find((button) => button.textContent?.includes('pluginMarket.explore'));
    await act(async () => {
      detailExplore?.click();
      await Promise.resolve();
    });

    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(openExternal).toHaveBeenNthCalledWith(1, 'https://github.com/pulse/computer-use');
  });

  it('surfaces an Explore failure without losing the catalog', async () => {
    const unsupported = listing({ installState: 'unsupported' });
    const openExternal = vi.fn(async () => ({ ok: false, error: 'Browser blocked' }));
    await render(createApi(snapshot([unsupported])), openExternal);

    const explore = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.includes('pluginMarket.explore'));
    await act(async () => {
      explore?.click();
      await Promise.resolve();
    });

    expect(host?.querySelector('[role="alert"]')?.textContent).toContain('Browser blocked');
    expect(host?.querySelector('[data-plugin-id="computer-use"]')).not.toBeNull();
  });

  it('adds local directories and Git sources from the Add menu', async () => {
    const api = createApi(snapshot([listing()]));
    await render(api);

    const addButton = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.includes('pluginMarket.add'));
    act(() => addButton?.click());
    const directoryButton = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.includes('pluginMarket.addDirectory'));
    await act(async () => {
      directoryButton?.click();
      await Promise.resolve();
    });
    expect(api.chooseDirectory).toHaveBeenCalledTimes(1);

    act(() => addButton?.click());
    const gitButton = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.includes('pluginMarket.addGit'));
    act(() => gitButton?.click());
    const url = document.querySelector<HTMLInputElement>('.plugin-market-modal input');
    await act(async () => {
      if (url) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
          ?.set?.call(url, 'https://github.com/pulse/plugin.git');
        url.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
    });
    const submit = [...document.querySelectorAll<HTMLButtonElement>('.plugin-market-modal button')]
      .find((button) => button.textContent?.includes('pluginMarket.addRepository'));
    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });

    expect(api.addGit).toHaveBeenCalledWith({
      kind: 'git',
      url: 'https://github.com/pulse/plugin.git',
      ref: undefined,
      subdir: undefined,
    });
  });

  it('opens details and keeps native Pulse code behind an explicit enable action', async () => {
    const native = listing({ installState: 'installed', nativeEnabled: false });
    const enabled = listing({ installState: 'installed', nativeEnabled: true });
    const api = createApi(snapshot([native]));
    vi.mocked(api.setNativeEnabled).mockResolvedValue({ ok: true, snapshot: snapshot([enabled]) });
    await render(api);

    const details = host?.querySelector<HTMLButtonElement>('.plugin-market__listing-main');
    act(() => details?.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    const enable = [...document.querySelectorAll<HTMLButtonElement>('.plugin-market-modal button')]
      .find((button) => button.textContent?.includes('pluginMarket.enableNative'));
    await act(async () => {
      enable?.click();
      await Promise.resolve();
    });

    expect(api.setNativeEnabled).toHaveBeenCalledWith('computer-use', true);
    expect(document.querySelector('.plugin-market-detail__native')?.textContent)
      .toContain('pluginMarket.disableNative');
  });

  it('connects an installed remote MCP plugin from its details', async () => {
    const disconnected = listing({ installState: 'installed', mcpAuthState: 'connectable' });
    const connected = listing({ installState: 'installed', mcpAuthState: 'connected' });
    const api = createApi(snapshot([disconnected]));
    vi.mocked(api.connectMcp).mockResolvedValue({ ok: true, snapshot: snapshot([connected]) });
    await render(api);

    act(() => host?.querySelector<HTMLButtonElement>('.plugin-market__listing-main')?.click());
    const connect = [...document.querySelectorAll<HTMLButtonElement>('.plugin-market-modal button')]
      .find((button) => button.textContent?.includes('pluginMarket.connect'));
    await act(async () => {
      connect?.click();
      await Promise.resolve();
    });

    expect(api.connectMcp).toHaveBeenCalledWith('computer-use');
    expect(document.querySelector('.plugin-market-detail__connection')?.textContent)
      .toContain('pluginMarket.connected');
  });
});
