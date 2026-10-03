// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { AgentSection } from './AgentSection';

vi.mock('../../../../shared/appShell', () => ({ useAppShell: () => ({ notify: vi.fn() }) }));
vi.mock('./AgentShellPathCard', () => ({ AgentShellPathCard: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });

async function renderStatus(installed: boolean, version: string | null) {
  const install = vi.fn(async () => ({ ok: true, results: [] }));
  vi.stubGlobal('canvasWorkspace', { skills: {
    status: vi.fn(async () => ({ installed, version, cliInstalled: installed,
      cliPath: '/local/pulse-canvas', results: [], legacyDirs: [], updatePolicy: 'follow-app' })),
    install,
  } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); };
  await act(async () => { root.render(<I18nProvider><AgentSection onClose={vi.fn()} /></I18nProvider>); });
  return { host, install };
}

describe('external Agent connection', () => {
  it('shows ready without technical diagnostics and keeps advanced settings collapsed', async () => {
    const { host } = await renderStatus(true, '1.0.0');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Ready');
    expect(host.querySelector('details')?.open).toBe(false);
    expect(host.textContent).not.toContain('Technical details');
    expect(host.textContent).not.toContain('/local/pulse-canvas');
    expect(host.textContent).not.toContain('Copy diagnostic information');
    expect([...host.querySelectorAll('button')].some(button => /Repair connection|Enable connection/.test(button.textContent ?? ''))).toBe(false);
  });
  it.each([[false, null, 'Enable connection'], [false, '1.0.0', 'Repair connection']] as const)(
    'offers the correct action for installed=%s version=%s', async (installed, version, label) => {
      const { host, install } = await renderStatus(installed, version);
      const button = [...host.querySelectorAll('button')].find(button => button.textContent === label);
      expect(button).toBeDefined();
      await act(async () => { button!.click(); });
      expect(install).toHaveBeenCalledOnce();
    },
  );
});
