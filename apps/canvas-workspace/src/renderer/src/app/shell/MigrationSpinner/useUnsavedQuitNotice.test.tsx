// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../AppShellProvider';
import { useUnsavedQuitNotice } from './useUnsavedQuitNotice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Probe = () => {
  useUnsavedQuitNotice();
  return null;
};

let host: HTMLDivElement;
let root: Root;
const original = window.canvasWorkspace;

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: original });
});

const render = async (pending: boolean) => {
  const consumeUnsavedQuit = vi.fn(async () => ({ ok: true, pending }));
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: { store: { consumeUnsavedQuit } },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider>
        <AppShellProvider>
          <Probe />
        </AppShellProvider>
      </I18nProvider>,
    );
    await Promise.resolve();
  });
  return consumeUnsavedQuit;
};

describe('useUnsavedQuitNotice', () => {
  it('tells the user once when the last quit left unsaved canvas edits', async () => {
    const consume = await render(true);
    expect(consume).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('Last session had unsaved changes');
  });

  it('stays quiet when the last quit finished saving', async () => {
    await render(false);
    expect(document.body.textContent ?? '').not.toContain('Last session had unsaved changes');
  });
});