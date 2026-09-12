// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { DockTabSwitcher } from '../DockTabSwitcher';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let mount: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); mount?.remove(); root = null; vi.restoreAllMocks(); });

const setup = async () => {
  const onActivate = vi.fn();
  const onReopen = vi.fn();
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  act(() => root?.render(<I18nProvider><DockTabSwitcher activeTabId="b" splitTabIds={['a', 'b']}
    items={[
      { id: 'a', kind: 'link', title: 'Reading notes', url: 'https://docs.example/article', faviconUrl: 'https://docs.example/icon.png' },
      { id: 'b', kind: 'link', title: 'Research', url: 'https://research.example' },
    ]}
    closedTabs={[{ id: 'closed', kind: 'link', title: 'Closed article', url: 'https://closed.example' }]}
    onActivate={onActivate} onReopen={onReopen} /></I18nProvider>));
  const trigger = mount.querySelector<HTMLButtonElement>('[aria-label="All tabs"]')!;
  act(() => trigger.click());
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  const input = document.querySelector<HTMLInputElement>('.right-dock__tab-search input')!;
  const type = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return { onActivate, onReopen, trigger, input, type };
};

describe('DockTabSwitcher search', () => {
  it('focuses search, shows domains and pane positions, then selects by domain', async () => {
    const { input, type, onActivate } = await setup();
    expect(document.activeElement).toBe(input);
    expect(document.body.textContent).toContain('Pinned right');
    expect(document.body.textContent).toContain('Left pane');
    type('docs.example');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(document.querySelector('.right-dock__tab-favicon')).toBeTruthy();
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onActivate).toHaveBeenCalledWith('a');
    expect(document.querySelector('.right-dock__tab-search')).toBeNull();
  });
  it('keeps IME Enter in the editor, handles no matches, and restores trigger on Escape', async () => {
    const { input, type, onActivate, trigger } = await setup();
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    expect(onActivate).not.toHaveBeenCalled();
    type('no-such-page');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('No matching tabs');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(trigger);
  });
  it('searches and restores a closed tab through the reopen action', async () => {
    const { input, type, onActivate, onReopen } = await setup();
    type('closed.example');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onReopen).toHaveBeenCalledWith(0);
    expect(onActivate).not.toHaveBeenCalled();
  });
});
