// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasPluginInstallReport } from '../../../../../../shared/plugin-market';
import { I18nProvider } from '../../../../i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fakes = vi.hoisted(() => ({
  setNativeEnabled: vi.fn(),
  syncRendererPlugins: vi.fn(),
  findInstalledListing: vi.fn(),
  requestOpenPluginPage: vi.fn(),
}));

vi.mock('../usePluginMarket', () => ({
  resolveApi: () => ({ setNativeEnabled: fakes.setNativeEnabled }),
  syncRendererPlugins: fakes.syncRendererPlugins,
}));
vi.mock('../installedPluginActions', () => ({ findInstalledListing: fakes.findInstalledListing }));
vi.mock('../../../../shared/appShell', () => ({ requestOpenPluginPage: fakes.requestOpenPluginPage }));
vi.mock('../../../../../../plugins/renderer', () => ({
  getRegisteredNavItems: () => [{ id: 'stats', path: '/plugin/session-stats', label: 'Stats', pluginId: 'session-stats' }],
}));

import { PluginInstallResult } from '.';

const report: CanvasPluginInstallReport = {
  ok: true,
  root: '/tmp/session-stats',
  listingId: 'personal:session-stats:abc',
  name: 'session-stats',
  version: '0.1.0',
  hasNativeCode: true,
  nativeEnabled: false,
  contents: { renderer: true, main: true, nodeTypes: [], skills: [], mcpServers: [] },
  diagnostics: [],
  nextStep: '',
};

let host: HTMLDivElement;
let root: Root;

const render = (result: string) => act(async () => {
  root.render(<I18nProvider><PluginInstallResult result={result} /></I18nProvider>);
});

beforeEach(() => {
  Object.values(fakes).forEach((fake) => fake.mockReset());
  fakes.findInstalledListing.mockResolvedValue(null);
  fakes.syncRendererPlugins.mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('PluginInstallResult', () => {
  it('enables native code only on click, then opens the plugin page', async () => {
    fakes.setNativeEnabled.mockResolvedValue({ ok: true });
    await render(JSON.stringify(report));

    expect(host.textContent).toContain('session-stats');
    expect(fakes.setNativeEnabled).not.toHaveBeenCalled();
    const button = host.querySelector<HTMLButtonElement>('.plugin-install-card__footer button')!;
    await act(async () => { button.click(); });

    expect(fakes.setNativeEnabled).toHaveBeenCalledWith('personal:session-stats:abc', true);
    expect(fakes.syncRendererPlugins).toHaveBeenCalled();
    expect(fakes.requestOpenPluginPage).toHaveBeenCalledWith('/plugin/session-stats');
  });

  it('shows the description and the sidebar entry for an enabled plugin, without technical labels', async () => {
    await render(JSON.stringify({ ...report, nativeEnabled: true, description: 'Track your session stats.' }));

    expect(host.textContent).toContain('Track your session stats.');
    expect(host.textContent).toContain('Stats');
    expect(host.textContent).not.toContain('Main process');
    expect(host.textContent).not.toContain('Enable and open');
    const open = host.querySelector<HTMLButtonElement>('.plugin-install-card__footer button')!;
    await act(async () => { open.click(); });
    expect(fakes.requestOpenPluginPage).toHaveBeenCalledWith('/plugin/session-stats');
    expect(fakes.setNativeEnabled).not.toHaveBeenCalled();
  });

  it('shows errors and no enable button for a failed install', async () => {
    await render(JSON.stringify({
      ...report,
      ok: false,
      error: 'Not an installable plugin package',
      diagnostics: [{ severity: 'error', scope: 'package', code: 'manifest.invalid', message: 'name is invalid' }],
    }));

    expect(host.textContent).toContain('name is invalid');
    expect(host.querySelector('.plugin-install-card__footer')).toBeNull();
  });

  it('renders nothing for a result that is not an install report', async () => {
    await render('Error: something else');

    expect(host.innerHTML).toBe('');
  });
});
