// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { ReferenceEntryList } from './index';
import type { LibraryItem } from '../libraryModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('keeps a bounded card window and restores position/focus after detail navigation', () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const positions = new Map<string, number>();
  const items: LibraryItem[] = Array.from({ length: 200 }, (_, i) => ({ id: `ws:${i}`, title: `Note ${i}`, summary: 'Summary', workspaceId: 'ws', kind: 'note', nodeType: 'file', entry: { kind: 'node', nodeId: String(i), workspaceId: 'ws' } }));
  const onOpen = vi.fn();
  const render = (visible: boolean, browseKey = 'current', returnedId?: string) => act(() => root.render(<I18nProvider><ReferenceEntryList items={items} visible={visible} browseKey={browseKey} positions={positions} returnedId={returnedId} workspaceNameById={new Map()} onOpen={onOpen} loading={false} /></I18nProvider>));
  try {
    render(true);
    const scroll = host.querySelector<HTMLDivElement>('.library-card-list')!;
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 520 });
    expect(host.querySelectorAll('[data-library-id]').length).toBeLessThan(15);
    act(() => { scroll.scrollTop = 4640; scroll.dispatchEvent(new Event('scroll', { bubbles: true })); });
    const card = host.querySelector<HTMLButtonElement>('[data-library-id="ws:20"]')!;
    act(() => card.click()); expect(onOpen).toHaveBeenCalledWith(items[20]);
    render(false, 'current', 'ws:20');
    act(() => { scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll', { bubbles: true })); });
    expect(positions.get('current')).toBe(4640);
    render(true, 'current', 'ws:20'); expect(scroll.scrollTop).toBe(4640);
    expect((document.activeElement as HTMLElement).dataset.libraryId).toBe('ws:20');
    render(true, 'other'); expect(scroll.scrollTop).toBe(0);
    render(true, 'current'); expect(scroll.scrollTop).toBe(4640);
  } finally { act(() => root.unmount()); host.remove(); }
});
