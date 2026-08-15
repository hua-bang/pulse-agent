import { describe, expect, it } from 'vitest';
import {
  ClosedLinkTabStack,
  allocateTabId,
  insertLinkTab,
  isSameOrigin,
  linkPaneKey,
} from '../dock-link-tabs';
import type { DockPreviewTab } from '../dock-types';

const link = (id: string, openerTabId?: string): DockPreviewTab => ({
  id,
  kind: 'link',
  title: id,
  url: `https://example.com/${id}`,
  ...(openerTabId ? { openerTabId } : {}),
});

describe('isSameOrigin', () => {
  it('holds across path, query and hash changes on one origin', () => {
    expect(isSameOrigin('https://app.example.com/a', 'https://app.example.com/b?x=1#y')).toBe(true);
  });

  it('rejects a different host, scheme, or port', () => {
    expect(isSameOrigin('https://a.example.com/', 'https://b.example.com/')).toBe(false);
    expect(isSameOrigin('https://example.com/', 'http://example.com/')).toBe(false);
    expect(isSameOrigin('https://example.com/', 'https://example.com:8443/')).toBe(false);
  });

  it('never guesses for unparseable or empty input', () => {
    expect(isSameOrigin('', 'https://example.com/')).toBe(false);
    expect(isSameOrigin('not a url', 'also not a url')).toBe(false);
    // …but an identical raw string is still the same page (about:blank).
    expect(isSameOrigin('about:blank', 'about:blank')).toBe(true);
  });
});

describe('allocateTabId', () => {
  it('returns the base id when free, else the first free suffix', () => {
    expect(allocateTabId([], 'link:a')).toBe('link:a');
    expect(allocateTabId([{ id: 'link:a' }], 'link:a')).toBe('link:a:2');
    expect(allocateTabId([{ id: 'link:a' }, { id: 'link:a:2' }], 'link:a')).toBe('link:a:3');
  });
});

describe('insertLinkTab', () => {
  it('appends when there is no live opener', () => {
    const tabs = [link('a'), link('b')];
    expect(insertLinkTab(tabs, link('c')).map((tab) => tab.id)).toEqual(['a', 'b', 'c']);
    // An opener that has since been closed must not silently reorder anything.
    expect(insertLinkTab(tabs, link('c'), 'gone').map((tab) => tab.id)).toEqual(['a', 'b', 'c']);
  });

  it('places a child directly after its opener', () => {
    const tabs = [link('a'), link('b')];
    const next = insertLinkTab(tabs, link('c', 'a'), 'a');
    expect(next.map((tab) => tab.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps a burst of links from one page in click order', () => {
    // Chrome semantics: each new child lands after the previous ones, so
    // clicking three links on page A reads A, 1, 2, 3 — not A, 3, 2, 1.
    let tabs = [link('a'), link('z')];
    tabs = insertLinkTab(tabs, link('c1', 'a'), 'a');
    tabs = insertLinkTab(tabs, link('c2', 'a'), 'a');
    tabs = insertLinkTab(tabs, link('c3', 'a'), 'a');
    expect(tabs.map((tab) => tab.id)).toEqual(['a', 'c1', 'c2', 'c3', 'z']);
  });

  it('does not run past an unrelated tab that follows the opener', () => {
    const tabs = [link('a'), link('other'), link('z')];
    const next = insertLinkTab(tabs, link('c', 'a'), 'a');
    expect(next.map((tab) => tab.id)).toEqual(['a', 'c', 'other', 'z']);
  });
});

describe('linkPaneKey', () => {
  it('uses the tab id as a stable application-global pane key', () => {
    expect(linkPaneKey('link:x')).toBe('link:x');
  });
});

describe('ClosedLinkTabStack', () => {
  it('pops most-recent-first globally', () => {
    const stack = new ClosedLinkTabStack();
    stack.push({ tab: link('a') as never, index: 0 });
    stack.push({ tab: link('b') as never, index: 1 });

    expect(stack.pop()?.tab.id).toBe('b');
    expect(stack.pop()?.tab.id).toBe('a');
    expect(stack.pop()).toBeUndefined();
  });

  it('reports whether a global entry exists', () => {
    const stack = new ClosedLinkTabStack();
    expect(stack.has()).toBe(false);
    stack.push({ tab: link('a') as never, index: 0 });

    expect(stack.has()).toBe(true);
    expect(stack.pop()?.tab.id).toBe('a');
    expect(stack.has()).toBe(false);
  });

  it('drops the oldest entry past the limit', () => {
    const stack = new ClosedLinkTabStack(2);
    stack.push({ tab: link('a') as never, index: 0 });
    stack.push({ tab: link('b') as never, index: 0 });
    stack.push({ tab: link('c') as never, index: 0 });

    expect(stack.pop()?.tab.id).toBe('c');
    expect(stack.pop()?.tab.id).toBe('b');
    expect(stack.pop()).toBeUndefined();
  });
});
