// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { PulseRouter, PulseRouterView } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let shouldThrow = true;

const Flaky = () => {
  if (shouldThrow) throw new Error('boom');
  return <span data-testid="settings">settings</span>;
};

const renderRoutes = async (active: 'canvas' | 'settings') => {
  await act(async () => {
    root.render(
      <I18nProvider>
        <nav data-testid="rail">rail</nav>
        <PulseRouter activeKey={active}>
          <PulseRouterView name="canvas" keepAlive>
            <span data-testid="canvas">canvas</span>
          </PulseRouterView>
          <PulseRouterView name="settings">
            <Flaky />
          </PulseRouterView>
        </PulseRouter>
      </I18nProvider>,
    );
  });
};

beforeEach(() => {
  shouldThrow = true;
  window.localStorage.setItem('pulse-canvas.language', 'en');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('route error boundary', () => {
  it('keeps the shell and other routes mounted when one route throws', async () => {
    await renderRoutes('settings');

    expect(host.querySelector('[data-testid="rail"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="canvas"]')).not.toBeNull();
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Try again');
    expect(alert?.textContent).toContain('Reload window');
  });

  it('remounts the route on Try again', async () => {
    await renderRoutes('settings');
    shouldThrow = false;

    const retry = [...host.querySelectorAll('button')]
      .find((button) => button.textContent === 'Try again');
    await act(async () => {
      retry?.click();
    });

    expect(host.querySelector('[data-testid="settings"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('starts fresh when the user leaves the failed route and returns', async () => {
    await renderRoutes('settings');
    await renderRoutes('canvas');
    shouldThrow = false;
    await renderRoutes('settings');

    expect(host.querySelector('[data-testid="settings"]')).not.toBeNull();
  });
});
