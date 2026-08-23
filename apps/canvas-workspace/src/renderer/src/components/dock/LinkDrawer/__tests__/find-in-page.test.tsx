// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { FindInPageBar } from '../FindInPageBar';
import { useFindInPage } from '../useFindInPage';
import type { EmbeddedWebviewTag } from '../../EmbeddedBrowser/types';
import {
  consumeDockPageFocusRequest,
  requestDockPageFocus,
} from '../../RightDock/dock-browser-commands';
import { DOCK_FIND_FALLBACK_CHANNEL } from '../../../../../../shared/dock-shortcuts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

const createWebview = () => {
  const element = document.createElement('div');
  let nextRequestId = 0;
  const findInPage = vi.fn(() => ++nextRequestId);
  const stopFindInPage = vi.fn();
  const focus = vi.fn();
  Object.assign(element, { findInPage, stopFindInPage, focus });
  return {
    webview: element as unknown as EmbeddedWebviewTag,
    findInPage,
    stopFindInPage,
    focus,
  };
};

let api: ReturnType<typeof useFindInPage>;

const Harness = ({
  webview,
  onRestorePageFocus,
}: {
  webview: EmbeddedWebviewTag | null;
  onRestorePageFocus?: () => void;
}) => {
  api = useFindInPage(webview, { onRestorePageFocus });
  return (
    <I18nProvider>
      {api.open && (
        <FindInPageBar
          query={api.query}
          matches={api.matches}
          barRef={api.barRef}
          onQueryChange={api.onQueryChange}
          onStep={api.step}
          onClose={api.close}
        />
      )}
    </I18nProvider>
  );
};

const render = (
  webview: EmbeddedWebviewTag | null,
  onRestorePageFocus?: () => void,
) => {
  act(() => root?.render(
    <Harness webview={webview} onRestorePageFocus={onRestorePageFocus} />,
  ));
};

const foundInPage = (
  webview: EmbeddedWebviewTag,
  requestId: number,
  activeMatchOrdinal: number,
  matches: number,
) => {
  const event = new Event('found-in-page') as Event & { result?: unknown };
  event.result = { requestId, activeMatchOrdinal, matches };
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

    foundInPage(webview, 1, 1, 4);
    expect(api.matches).toEqual({ active: 1, total: 4 });
  });

  it('keeps the newest search result when Chromium replies out of order', () => {
    const { webview } = createWebview();
    render(webview);

    act(() => api.onQueryChange('need'));
    act(() => api.onQueryChange('needle'));
    foundInPage(webview, 2, 2, 6);
    foundInPage(webview, 1, 1, 20);

    expect(api.matches).toEqual({ active: 2, total: 6 });
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
    foundInPage(webview, 1, 1, 4);

    act(() => api.onQueryChange(''));
    foundInPage(webview, 1, 2, 4);

    expect(stopFindInPage).toHaveBeenCalledWith('clearSelection');
    expect(api.matches).toEqual({ active: 0, total: 0 });
  });

  it('does not step with an empty query', () => {
    const { webview, findInPage } = createWebview();
    render(webview);

    act(() => api.step(true));
    expect(findInPage).not.toHaveBeenCalled();
  });

  it('closes from Escape, ignores late results, and restores page focus', () => {
    const { webview, stopFindInPage, focus } = createWebview();
    render(webview);
    act(() => api.openFind());
    act(() => api.onQueryChange('needle'));
    foundInPage(webview, 1, 2, 9);
    expect(api.open).toBe(true);

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { mount?.querySelector('input')?.dispatchEvent(escape); });
    foundInPage(webview, 1, 3, 9);

    expect(api.open).toBe(false);
    expect(api.matches).toEqual({ active: 0, total: 0 });
    expect(stopFindInPage).toHaveBeenLastCalledWith('clearSelection');
    expect(focus).toHaveBeenCalledOnce();
    expect(escape.defaultPrevented).toBe(true);
  });

  it('restores page focus when the close button dismisses the find bar', () => {
    const { webview, focus } = createWebview();
    render(webview);
    act(() => api.openFind());

    const closeButton = mount?.querySelector<HTMLButtonElement>(
      'button[aria-label="Close find bar"]',
    );
    act(() => closeButton?.click());

    expect(api.open).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
  });

  it('re-runs a retained query when the find bar is opened again', () => {
    const { webview, findInPage } = createWebview();
    render(webview);
    act(() => api.openFind());
    act(() => api.onQueryChange('needle'));
    act(() => api.close());

    findInPage.mockClear();
    act(() => api.openFind());

    expect(api.query).toBe('needle');
    expect(findInPage).toHaveBeenCalledWith('needle', undefined);
  });

  it('replays an open retained query when a discarded guest is replaced', () => {
    const first = createWebview();
    const replacement = createWebview();
    render(first.webview);
    act(() => api.openFind());
    act(() => api.onQueryChange('needle'));

    render(replacement.webview);

    expect(replacement.findInPage).toHaveBeenCalledWith('needle', undefined);
    expect(api.matches).toEqual({ active: 0, total: 0 });
  });

  it('drops a stale count when the tab navigates away', () => {
    const { webview } = createWebview();
    render(webview);
    act(() => api.onQueryChange('needle'));
    foundInPage(webview, 1, 1, 4);

    act(() => { webview.dispatchEvent(new Event('did-navigate')); });
    foundInPage(webview, 1, 2, 4);

    expect(api.matches).toEqual({ active: 0, total: 0 });
  });

  it('survives a guest that is not mounted yet', () => {
    render(null);
    expect(() => act(() => api.onQueryChange('needle'))).not.toThrow();
    expect(() => act(() => api.close())).not.toThrow();
  });

  it('cancels a queued page-focus intent when Find becomes the newer destination', () => {
    render(null);
    requestDockPageFocus({ workspaceId: 'ws-a', tabId: 'cold-tab' });

    act(() => api.openFind());

    expect(consumeDockPageFocusRequest({ workspaceId: 'ws-a', tabId: 'cold-tab' })).toBe(false);
  });

  it('delegates close focus when a queued guest is not mounted yet', () => {
    const restore = vi.fn();
    render(null, restore);
    act(() => api.openFind());

    act(() => api.close());

    expect(restore).toHaveBeenCalledOnce();
  });

  it('opens the host fallback when the guest reports an unhandled Find chord', () => {
    const { webview } = createWebview();
    render(webview);
    const event = new Event('ipc-message') as Event & { channel?: string };
    event.channel = DOCK_FIND_FALLBACK_CHANNEL;

    act(() => { webview.dispatchEvent(event); });

    expect(api.open).toBe(true);
  });
});
