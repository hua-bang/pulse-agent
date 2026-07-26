// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloseButton, FocusButton, OpenTabButton } from './NodeButtons';
import { I18nProvider } from '../../i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  host?.remove();
  root = null;
  host = null;
});

describe('OpenTabButton', () => {
  it('uses tab semantics and invokes the tab action', () => {
    const onClick = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <I18nProvider>
          <OpenTabButton nodeTitle="Technical plan" onClick={onClick} />
        </I18nProvider>,
      );
    });

    const button = host.querySelector('button');
    expect(button?.className).toBe('node-open-tab');
    expect(button?.title).toBe('Open in tab');
    expect(button?.getAttribute('aria-label')).toBe('Open Technical plan in tab');
    expect(button?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('names focus and remove controls and hides decorative icons', () => {
    const onClick = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <I18nProvider>
          <FocusButton onClick={onClick} />
          <CloseButton onClick={onClick} />
        </I18nProvider>,
      );
    });

    const focus = host.querySelector<HTMLButtonElement>('.node-focus');
    const close = host.querySelector<HTMLButtonElement>('.node-close');
    expect(focus?.getAttribute('aria-label')).toBe('Focus node');
    expect(close?.getAttribute('aria-label')).toBe('Remove node');
    expect(focus?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(close?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
