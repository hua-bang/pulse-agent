import { describe, expect, it } from 'vitest';
import { toAddressSuggestion } from '../AddressSuggestions';
import type { BrowsingHistoryEntry } from '../../../../../shared/browsing-history';

const entry = (overrides: Partial<BrowsingHistoryEntry>): BrowsingHistoryEntry => ({
  url: 'https://example.com/docs',
  title: 'Example Docs',
  visitCount: 1,
  firstVisitedAt: 1,
  lastVisitedAt: 1,
  ...overrides,
});

describe('toAddressSuggestion', () => {
  it('maps an ordinary page to title + url', () => {
    const s = toAddressSuggestion(entry({ faviconUrl: 'https://example.com/icon.png' }));
    expect(s).toEqual({
      url: 'https://example.com/docs',
      label: 'Example Docs',
      detail: 'https://example.com/docs',
      faviconUrl: 'https://example.com/icon.png',
      isSearch: false,
    });
  });

  it('falls back to the url when a page has no title yet', () => {
    const s = toAddressSuggestion(entry({ title: '' }));
    expect(s.label).toBe('https://example.com/docs');
    expect(s.isSearch).toBe(false);
  });

  it('surfaces a search-result visit as the search it was', () => {
    const s = toAddressSuggestion(entry({
      url: 'https://www.google.com/search?q=%E5%A6%82%E4%BD%95%E7%85%AE%E7%B1%B3%E9%A5%AD',
      title: '如何煮米饭 - Google 搜索',
    }));
    expect(s.isSearch).toBe(true);
    expect(s.label).toBe('如何煮米饭');
    expect(s.detail).toBe('www.google.com');
  });
});
