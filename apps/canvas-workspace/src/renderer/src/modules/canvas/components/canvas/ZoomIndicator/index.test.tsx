// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { ZoomIndicator } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ZoomIndicator', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const button = (label: string) => {
    const found = Array.from(document.querySelectorAll('button'))
      .find((item) => item.getAttribute('aria-label') === label || item.textContent?.trim() === label);
    if (!found) throw new Error(`no button ${label}`);
    return found;
  };

  const menuLabels = () => Array.from(document.querySelectorAll('.zoom-indicator-menu [role="menuitem"]'))
    .map((item) => item.textContent?.trim());

  it('steps zoom with −/+ and picks a preset from the percentage menu', () => {
    const onZoomBy = vi.fn();
    const onZoomTo = vi.fn();
    const onReset = vi.fn();
    act(() => root.render(
      <I18nProvider>
        <ZoomIndicator scale={0.8} onReset={onReset} onFitAll={vi.fn()} onZoomBy={onZoomBy} onZoomTo={onZoomTo} />
      </I18nProvider>,
    ));

    act(() => button('Zoom in').click());
    act(() => button('Zoom out').click());
    expect(onZoomBy).toHaveBeenNthCalledWith(1, 1.2);
    expect(onZoomBy.mock.calls[1][0]).toBeCloseTo(1 / 1.2);

    act(() => button('80%').click());
    expect(onReset).not.toHaveBeenCalled();
    // No selection: the menu leaves out "Zoom to selection".
    expect(menuLabels()).toEqual(['50%', '100%', '200%', 'Zoom to fit']);

    act(() => button('200%').click());
    expect(onZoomTo).toHaveBeenCalledWith(2);
    expect(document.querySelector('.zoom-indicator-menu')).toBeNull();
  });

  it('offers zoom to selection when there is one', () => {
    const onFitSelection = vi.fn();
    act(() => root.render(
      <I18nProvider>
        <ZoomIndicator scale={1} onReset={vi.fn()} onZoomTo={vi.fn()} onFitSelection={onFitSelection} />
      </I18nProvider>,
    ));
    act(() => button('100%').click());
    act(() => button('Zoom to selection').click());
    expect(onFitSelection).toHaveBeenCalledOnce();
  });

  it('keeps the reset-to-100% click when no preset handler is wired', () => {
    const onReset = vi.fn();
    act(() => root.render(
      <I18nProvider>
        <ZoomIndicator scale={1.5} onReset={onReset} />
      </I18nProvider>,
    ));
    act(() => button('150%').click());
    expect(onReset).toHaveBeenCalledOnce();
    expect(document.querySelector('.zoom-indicator-menu')).toBeNull();
  });
});
