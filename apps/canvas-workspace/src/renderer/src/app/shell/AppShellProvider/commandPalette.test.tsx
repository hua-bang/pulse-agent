// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { publishAppCommands, requestOpenAppCommandPalette } from '../../../shared/appCommands';
import { AppShellProvider } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  publishAppCommands([]);
});

const waitForPalette = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (document.querySelector('.command-palette')) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
};

describe('app command palette', () => {
  it('opens on request, lists app commands, and runs one', async () => {
    const run = vi.fn();
    publishAppCommands([{ id: 'workspace:w1', title: 'Open workspace: Research', run }]);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<I18nProvider><AppShellProvider><div /></AppShellProvider></I18nProvider>));

    expect(document.querySelector('.command-palette')).toBeNull();
    await act(async () => requestOpenAppCommandPalette());
    await waitForPalette();

    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
      .find((element) => element.textContent?.includes('Open workspace: Research'));
    expect(option).toBeDefined();
    await act(async () => option?.click());

    expect(run).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.command-palette')).toBeNull();
  });
});
