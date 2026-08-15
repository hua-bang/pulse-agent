import { describe, expect, it } from 'vitest';
import {
  ClosedLinkTabStack,
  allocateTabId,
  applyRetainedTabPatch,
  insertLinkTab,
  isSameOrigin,
  linkPaneKey,
  updateRetainedLinkTabs,
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

describe('updateRetainedLinkTabs', () => {
  const entry = (workspaceId: string, ids: string[]) => ({
    workspaceId,
    tabs: ids.map((id) => link(id)) as never[],
    activeTabId: ids[0],
  });

  it('retains the workspace being left, most recent first', () => {
    const next = updateRetainedLinkTabs([], entry('ws1', ['a']), 'ws2');
    expect(next.map((item) => item.workspaceId)).toEqual(['ws1']);

    const after = updateRetainedLinkTabs(next, entry('ws2', ['b']), 'ws3');
    expect(after.map((item) => item.workspaceId)).toEqual(['ws2', 'ws1']);
  });

  it('drops the workspace being entered — its tabs become live again', () => {
    const current = [entry('ws1', ['a']), entry('ws2', ['b'])];
    const next = updateRetainedLinkTabs(current, entry('ws3', ['c']), 'ws1');
    expect(next.map((item) => item.workspaceId)).toEqual(['ws3', 'ws2']);
  });

  it('retains nothing for a workspace with no web tabs', () => {
    // An empty canvas holds no guests, so it must not push a useful entry
    // off the tail just by being visited.
    const current = [entry('ws1', ['a'])];
    const next = updateRetainedLinkTabs(current, entry('ws2', []), 'ws3');
    expect(next.map((item) => item.workspaceId)).toEqual(['ws1']);
  });

  it('evicts past the limit, oldest first', () => {
    let retained = updateRetainedLinkTabs([], entry('ws1', ['a']), 'ws2');
    retained = updateRetainedLinkTabs(retained, entry('ws2', ['b']), 'ws3');
    retained = updateRetainedLinkTabs(retained, entry('ws3', ['c']), 'ws4');
    expect(retained.map((item) => item.workspaceId)).toEqual(['ws3', 'ws2']);
  });

  it('refreshes an entry instead of duplicating it', () => {
    const current = [entry('ws1', ['a'])];
    const next = updateRetainedLinkTabs(current, entry('ws1', ['a', 'b']), 'ws2');
    expect(next).toHaveLength(1);
    expect(next[0].tabs.map((tab) => tab.id)).toEqual(['a', 'b']);
  });
});

describe('applyRetainedTabPatch', () => {
  const retained = () => [{
    workspaceId: 'ws1',
    tabs: [link('a'), link('b')] as never[],
    activeTabId: 'a',
  }];

  it('records a background navigation on the right tab', () => {
    // The stored URL is what the tab is restored to; letting it drift from
    // the live guest makes the restore a navigation command that yanks the
    // page back.
    const next = applyRetainedTabPatch(retained(), 'ws1', 'b', { url: 'https://moved.example/' });
    expect(next?.[0].tabs.map((tab) => tab.url)).toEqual([
      'https://example.com/a',
      'https://moved.example/',
    ]);
  });

  it('is a no-op for an unknown workspace, unknown tab, or unchanged value', () => {
    expect(applyRetainedTabPatch(retained(), 'other', 'a', { title: 'x' })).toBeNull();
    expect(applyRetainedTabPatch(retained(), 'ws1', 'zzz', { title: 'x' })).toBeNull();
    expect(applyRetainedTabPatch(retained(), 'ws1', 'a', { url: 'https://example.com/a' })).toBeNull();
  });
});

describe('linkPaneKey', () => {
  it('keeps same-id tabs in different workspaces apart', () => {
    // Tab ids are derived from the URL, so two canvases holding the same page
    // produce the same id — the mounted-pane bookkeeping must not conflate them.
    expect(linkPaneKey('ws1', 'link:x')).not.toBe(linkPaneKey('ws2', 'link:x'));
  });
});

describe('ClosedLinkTabStack', () => {
  it('pops most-recent-first within a workspace', () => {
    const stack = new ClosedLinkTabStack();
    stack.push({ tab: link('a') as never, index: 0, workspaceId: 'ws1' });
    stack.push({ tab: link('b') as never, index: 1, workspaceId: 'ws1' });

    expect(stack.pop('ws1')?.tab.id).toBe('b');
    expect(stack.pop('ws1')?.tab.id).toBe('a');
    expect(stack.pop('ws1')).toBeUndefined();
  });

  it('never hands a tab to a different workspace', () => {
    const stack = new ClosedLinkTabStack();
    stack.push({ tab: link('a') as never, index: 0, workspaceId: 'ws1' });

    expect(stack.has('ws2')).toBe(false);
    expect(stack.pop('ws2')).toBeUndefined();
    // ws1's entry is untouched by the miss.
    expect(stack.pop('ws1')?.tab.id).toBe('a');
  });

  it('drops the oldest entry past the limit', () => {
    const stack = new ClosedLinkTabStack(2);
    stack.push({ tab: link('a') as never, index: 0, workspaceId: 'ws1' });
    stack.push({ tab: link('b') as never, index: 0, workspaceId: 'ws1' });
    stack.push({ tab: link('c') as never, index: 0, workspaceId: 'ws1' });

    expect(stack.pop('ws1')?.tab.id).toBe('c');
    expect(stack.pop('ws1')?.tab.id).toBe('b');
    expect(stack.pop('ws1')).toBeUndefined();
  });
});
