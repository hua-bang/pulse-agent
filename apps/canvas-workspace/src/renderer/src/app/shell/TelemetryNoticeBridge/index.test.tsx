// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../AppShellProvider';
import type { TelemetryStatus } from '../../../types';
import { TelemetryNoticeBridge } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  delete (window as { canvasWorkspace?: unknown }).canvasWorkspace;
});

async function mount(status: TelemetryStatus) {
  const setEnabled = vi.fn(async (enabled: boolean) => ({ ...status, enabled, noticeSeen: true }));
  (window as { canvasWorkspace?: unknown }).canvasWorkspace = {
    telemetry: { status: vi.fn(async () => status), setEnabled, track: vi.fn() },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(
    <I18nProvider><AppShellProvider><TelemetryNoticeBridge /></AppShellProvider></I18nProvider>,
  ));
  return setEnabled;
}

const button = (label: string) => Array.from(document.querySelectorAll('button'))
  .find((element) => element.textContent === label);

describe('TelemetryNoticeBridge', () => {
  it('keeps telemetry on when the user accepts the notice', async () => {
    const setEnabled = await mount({ configured: true, enabled: true, noticeSeen: false });
    expect(document.body.textContent).toContain('Nothing is sent until you choose.');
    await act(async () => button('Send usage data')?.click());
    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it('turns telemetry off when the user declines the notice', async () => {
    const setEnabled = await mount({ configured: true, enabled: true, noticeSeen: false });
    await act(async () => button('Don’t send')?.click());
    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  it('shows nothing once seen or in a build without a gateway', async () => {
    await mount({ configured: true, enabled: false, noticeSeen: true });
    expect(document.body.textContent).not.toContain('Nothing is sent until you choose.');
    act(() => root?.unmount());
    host?.remove();
    root = null;
    await mount({ configured: false, enabled: true, noticeSeen: false });
    expect(document.body.textContent).not.toContain('Nothing is sent until you choose.');
  });
});
