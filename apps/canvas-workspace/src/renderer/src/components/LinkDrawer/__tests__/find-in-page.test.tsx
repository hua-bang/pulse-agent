// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFindInPage } from '../useFindInPage';
import type { EmbeddedWebviewTag } from '../../EmbeddedBrowser/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

const createWebview = () => {
  const element = document.createElement('div');
  const findInPage = vi.fn();
  const stopFindInPage = vi.fn();
  Object.assign(element, { findInPage, stopFindInPage });
  return { webview: element as unknown as EmbeddedWebviewTag, findInPage, stopFindInPage };
};

let api: ReturnType<typeof useFindInPage>;

const Harness = ({ webview }: { webview: EmbeddedWebviewTag | null }) => {
  api = useFindInPage(webview);
  return <div ref={api.barRef}><input /></div>;
};

const render = (webview: EmbeddedWebviewTag | null) => {
  act(() => root?.render(<Harness webview={webview} />));
};

const foundInPage = (webview: EmbeddedWebviewTag, activeMatchOrdinal: number, matches: number) => {
  const event = new Event('found-in-page') as Event & { result?: unknown };
  event.result = { activeMatchOrdinal, matches };
  act(() => { webview.dispatchEvent(event); });
};

beforeEach(() => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

describe('useFindInPage', () => {
  it('starts a fresh search as the query changes and reports the match count', () => {
    const { webview, findInPage } = createWebview();
    render(webview);

    act(() => api.onQueryChange('needle'));
    expect(findInPage).toHaveBeenCalledWith('needle', undefined);

    foundInPage(webview, 1, 4);
    expect(api.matches).toEqual({ active: 1, total: 4 });
  });

  it('steps through existing results instead of re-running the search', () => {
    // findNext is what tells Chromium "same query, move the cursor" — without
    // it every press restarts at the first match.
    const { webview, findInPage } = createWebview();
    render(webview);
    act(() => api.onQueryChange('needle'));

    act(() => api.step(true));
    expect(findInPage).toHaveBeenLastCalledWith('needle', { findNext: true, forward: true });

    act(() => api.step(false));
    expect(findInPage).toHaveBeenLastCalledWith('needle', { findNext: true, forward: false });
  });

  it('clears the highlight when the query is emptied', () => {
    const { webview, stopFindInPage } = createWebview();
    render(webview);
    act(() => api.onQueryChange('needle'));
    foundInPage(webview, 1, 4);

    act(() => api.onQueryChange(''));

    expect(stopFindInPage).toHaveBeenCalledWith('clearSelection');
    expect(api.matches).toEqual({ active: 0, total: 0 });
  });

  it('does not step with an empty query', () => {
    const { webview, findInPage } = createWebview();
    render(webview);

    act(() => api.step(true));
    expect(findInPage).not.toHaveBeenCalled();
  });

  it('clears the highlight and the count on close', () => {
    const { webview, stopFindInPage } = createWebview();
    render(webview);
    act(() => api.openFind());
    act(() => api.onQueryChange('needle'));
    foundInPage(webview, 2, 9);
    expect(api.open).toBe(true);

    act(() => api.close());

    expect(api.open).toBe(false);
    expect(api.matches).toEqual({ active: 0, total: 0 });
    expect(stopFindInPage).toHaveBeenLastCalledWith('clearSelection');
  });

  it('drops a stale count when the tab navigates away', () => {
    const { webview } = createWebview();
    render(webview);
    act(() => api.onQueryChange('needle'));
    foundInPage(webview, 1, 4);

    act(() => { webview.dispatchEvent(new Event('did-navigate')); });

    expect(api.matches).toEqual({ active: 0, total: 0 });
  });

  it('survives a guest that is not mounted yet', () => {
    render(null);
    expect(() => act(() => api.onQueryChange('needle'))).not.toThrow();
    expect(() => act(() => api.close())).not.toThrow();
  });
});
