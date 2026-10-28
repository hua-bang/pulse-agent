// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { DockTabSwitcher } from '../tabs/DockTabSwitcher';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let mount: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); mount?.remove(); root = null; vi.restoreAllMocks(); });

const archivedEntry = (index: number) => ({
  item: { id: `old-${index}`, kind: 'link' as const, title: `Old ${index}`, url: `https://old-${index}.example` },
  closedAt: Date.now() - 2 * 60 * 60_000,
  reason: 'idle' as const,
});

const setup = async (splitTabIds: string[] = ['a', 'b'], extraArchived = 0) => {
  const onActivate = vi.fn();
  const onReopen = vi.fn();
  const onRemoveArchived = vi.fn();
  const onClearArchive = vi.fn();
  const onClose = vi.fn();
  const onCloseInactive = vi.fn();
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  act(() => root?.render(<I18nProvider><DockTabSwitcher activeTabId="b" splitTabIds={splitTabIds}
    items={[
      { id: 'a', kind: 'link', title: 'Reading notes', url: 'https://docs.example/article', faviconUrl: 'https://docs.example/icon.png' },
      { id: 'b', kind: 'link', title: 'Research', url: 'https://research.example' },
    ]}
    archived={[
      { item: { id: 'closed', kind: 'link', title: 'Closed article', url: 'https://closed.example' }, closedAt: Date.now() - 3 * 24 * 60 * 60_000, reason: 'manual' },
      ...Array.from({ length: extraArchived }, (_, index) => archivedEntry(index)),
    ]}
    onRemoveArchived={onRemoveArchived} onClearArchive={onClearArchive}
    lastActiveAt={{ a: 1, b: 2 }} getInactiveCount={() => 1} onCloseInactive={onCloseInactive}
    onClose={onClose} onActivate={onActivate} onReopen={onReopen} /></I18nProvider>));
  const trigger = mount.querySelector<HTMLButtonElement>('[aria-label="All tabs"]')!;
  act(() => trigger.click());
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  const input = document.querySelector<HTMLInputElement>('.right-dock__tab-search input')!;
  const type = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return { onActivate, onReopen, onClose, onCloseInactive, onRemoveArchived, onClearArchive, trigger, input, type };
};

describe('DockTabSwitcher search', () => {
  it('offers one cleanup action for inactive tabs while not searching', async () => {
    const { type, input, onCloseInactive, onActivate } = await setup();
    const cleanup = () => document.querySelector<HTMLButtonElement>('.right-dock__tab-search-cleanup');
    expect(cleanup()?.textContent).toBe('Archive tabs unused for 3 days (1)');
    act(() => cleanup()!.click());
    expect(onCloseInactive).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    type('docs');
    expect(cleanup()).toBeNull();
  });

  it('closes a matching open webpage without activating it or dismissing search', async () => {
    const { type, input, onActivate, onClose, onReopen } = await setup();
    expect(document.querySelectorAll('[aria-label^="Close "]')).toHaveLength(2);
    expect(document.querySelector('[aria-label="Close Closed article"]')).toBeNull();
    type('docs.example');
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close Reading notes"]')!;
    expect(close.closest('[role="option"]')).toBeNull();
    act(() => close.click());
    expect(onClose).toHaveBeenCalledWith('a');
    expect(onActivate).not.toHaveBeenCalled();
    expect(onReopen).not.toHaveBeenCalled();
    expect(document.querySelector('.right-dock__tab-search')).not.toBeNull();
    expect(input.value).toBe('docs.example');
    expect(document.activeElement).toBe(input);
  });
  it('focuses search, shows domains and pane positions, then selects by domain', async () => {
    const { input, type, onActivate } = await setup();
    expect(document.activeElement).toBe(input);
    expect(document.body.textContent).toContain('Right pane');
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

describe('DockTabSwitcher archive', () => {
  it('shows the archive count, reason and age, and removes or clears entries', async () => {
    const { onRemoveArchived, onClearArchive, onReopen } = await setup(undefined, 1);
    const heading = document.querySelector('.right-dock__tab-search-heading--archive');
    expect(heading?.textContent).toContain('Archived · 2');
    expect(document.body.textContent).toContain('closed.example · Closed · 3 days ago');
    expect(document.body.textContent).toContain('old-0.example · Unused · 2 hours ago');
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Delete Old 0 from archive"]')!.click());
    expect(onRemoveArchived).toHaveBeenCalledWith(1);
    expect(onReopen).not.toHaveBeenCalled();
    act(() => document.querySelector<HTMLButtonElement>('.right-dock__tab-search-clear')!.click());
    expect(onClearArchive).toHaveBeenCalledTimes(1);
  });

  it('lists five archived tabs until "show all", and every match while searching', async () => {
    const { type } = await setup(undefined, 6);
    const archivedRows = () => document.querySelectorAll('[role="option"][title^="https://old-"], [role="option"][title^="https://closed"]');
    expect(archivedRows()).toHaveLength(5);
    const showAll = document.querySelector<HTMLButtonElement>('.right-dock__tab-search-show-all')!;
    expect(showAll.textContent).toBe('Show all 7');
    act(() => showAll.click());
    expect(archivedRows()).toHaveLength(7);
    type('old-');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(6);
  });
});

it('opens on the archive when the toast asks to view it', async () => {
  let listener: (() => void) | undefined;
  let pending = false;
  const reveal = {
    subscribeReveal: (next: () => void) => { listener = next; return () => { listener = undefined; }; },
    takeReveal: () => { const value = pending; pending = false; return value; },
  };
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  act(() => root?.render(<I18nProvider><DockTabSwitcher activeTabId="a" reveal={reveal} onActivate={vi.fn()}
    items={[{ id: 'a', kind: 'link', title: 'Open', url: 'https://open.example' }]}
    archived={[archivedEntry(0)]} /></I18nProvider>));
  expect(document.querySelector('.right-dock__tab-search')).toBeNull();
  pending = true;
  act(() => listener?.());
  expect(document.querySelector('.right-dock__tab-search')).not.toBeNull();
  expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain('Old 0');
});

it('keeps selection highlighting without a redundant Visible label in single-pane mode', async () => {
  await setup([]);
  expect(document.querySelector('.right-dock__tab-position')).toBeNull();
  expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain('Research');
});
