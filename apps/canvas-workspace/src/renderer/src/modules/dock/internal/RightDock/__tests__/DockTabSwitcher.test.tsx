// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { DockTabSwitcher } from '../DockTabSwitcher';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  document.querySelectorAll('.right-dock__tab-switcher-menu').forEach((node) => node.remove());
  vi.restoreAllMocks();
  root = null;
  mount = null;
});

describe('DockTabSwitcher', () => {
  it('keeps every tab discoverable, starts on the current item, and activates a selection', async () => {
    const onActivate = vi.fn();
    const nativeFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function focusVisible(
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      let current: HTMLElement | null = this;
      while (current) {
        // Match Chromium: a descendant of the rect-anchored Popover's
        // first, visibility:hidden measurement commit cannot take focus.
        if (current.style.visibility === 'hidden') return;
        current = current.parentElement;
      }
      nativeFocus.call(this, options);
    });
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);

    act(() => root?.render(
      <I18nProvider>
        <DockTabSwitcher
          activeTabId="web-b"
          items={[
            { id: 'chat', title: 'Pulse AI', kind: 'chat' },
            {
              id: 'web-a',
              title: 'Example A',
              kind: 'link',
              faviconUrl: 'https://example.com/favicon.ico',
            },
            { id: 'web-b', title: 'Example B', kind: 'link' },
          ]}
          onActivate={onActivate}
        />
      </I18nProvider>,
    ));

    const trigger = mount.querySelector<HTMLButtonElement>('[aria-label="All tabs"]')!;
    expect(trigger).toBeTruthy();
    act(() => trigger.click());
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    const menu = document.querySelector<HTMLElement>('.right-dock__tab-switcher-menu')!;
    expect(menu.getAttribute('aria-label')).toBe('All tabs');
    const rows = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(rows.map((item) => item.textContent))
      .toEqual(['Pulse AI', 'Example A', 'Example B']);
    expect(rows.every((item) => item.querySelector('.right-dock__tab-icon'))).toBe(true);
    expect(rows[0]?.querySelector('.right-dock__tab-icon--chat img')).toBeTruthy();
    expect(rows[1]?.querySelector<HTMLImageElement>('.right-dock__tab-favicon')?.src)
      .toBe('https://example.com/favicon.ico');
    expect(rows[2]?.querySelector('.right-dock__tab-icon--link svg')).toBeTruthy();
    expect(menu.querySelector('[aria-checked="true"]')?.textContent).toBe('Example B');
    expect(document.activeElement?.textContent).toBe('Example B');

    const firstWebTab = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
      .find((item) => item.textContent === 'Example A')!;
    act(() => firstWebTab.click());

    expect(onActivate).toHaveBeenCalledWith('web-a');
    expect(document.querySelector('.right-dock__tab-switcher-menu')).toBeNull();
  });
});
