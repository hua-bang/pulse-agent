// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';
import { useEmbeddedBrowser } from './useEmbeddedBrowser';
import type { EmbeddedWebviewTag } from './types';

let root: Root | null = null;
let mount: HTMLDivElement | null = null;
let webview: EmbeddedWebviewTag;

beforeEach(() => {
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'webview') return createElement(tag);
    webview = createElement('div') as unknown as EmbeddedWebviewTag;
    webview.canGoBack = vi.fn(() => true);
    webview.canGoForward = vi.fn(() => false);
    webview.getTitle = vi.fn(() => 'Example page');
    webview.goBack = vi.fn();
    webview.goForward = vi.fn();
    webview.reload = vi.fn();
    return webview;
  }) as typeof document.createElement);
});

afterEach(() => {
  flushSync(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
  vi.restoreAllMocks();
});

describe('useEmbeddedBrowser', () => {
  it('owns webview lifecycle, navigation state, and commands behind one interface', () => {
    const onNavigate = vi.fn();
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    flushSync(() => root?.render(<Harness onNavigate={onNavigate} />));

    expect(webview.getAttribute('allowpopups')).toBe('');
    expect(webview.getAttribute('src')).toBe('https://example.com');

    const event = new Event('did-navigate') as Event & { url: string };
    event.url = 'https://example.com/next';
    flushSync(() => webview.dispatchEvent(event));
    expect(onNavigate).toHaveBeenCalledWith('https://example.com/next');

    const back = mount.querySelector('button');
    flushSync(() => back?.click());
    expect(vi.mocked(webview.goBack)).toHaveBeenCalledOnce();

    flushSync(() => webview.dispatchEvent(new Event('did-stop-loading')));
    expect(onNavigate).toHaveBeenCalledWith('https://example.com/next');
  });

  it('uses the guest title after loading even when no title event fired', () => {
    const onTitleChange = vi.fn();
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    flushSync(() => root?.render(<TitleHarness onTitleChange={onTitleChange} />));

    flushSync(() => webview.dispatchEvent(new Event('did-stop-loading')));

    expect(onTitleChange).toHaveBeenCalledWith('Example page');
  });

  it('does not reload a guest when an external store synchronously persists did-navigate', () => {
    const store = createUrlStore('https://example.com');
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    flushSync(() => root?.render(<ExternalStoreHarness store={store} />));

    const setAttribute = vi.spyOn(webview, 'setAttribute');
    const event = new Event('did-navigate-in-page') as Event & { url: string };
    event.url = 'https://example.com/next';
    webview.dispatchEvent(event);

    expect(setAttribute).not.toHaveBeenCalledWith('src', 'https://example.com/next');
  });

  it('loads a URL that comes from an external navigation command', () => {
    const store = createUrlStore('https://example.com');
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    flushSync(() => root?.render(<ExternalStoreHarness store={store} />));

    const setAttribute = vi.spyOn(webview, 'setAttribute');
    flushSync(() => store.set('https://example.com/external'));

    expect(setAttribute).toHaveBeenCalledWith('src', 'https://example.com/external');
  });

  it('ignores duplicate same-URL in-page navigation while reporting real URL changes', () => {
    const onNavigate = vi.fn();
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    flushSync(() => root?.render(<Harness onNavigate={onNavigate} />));

    const mainNavigation = new Event('did-navigate') as Event & { url: string };
    mainNavigation.url = 'https://example.com';
    flushSync(() => webview.dispatchEvent(mainNavigation));

    const duplicateInPageNavigation = new Event('did-navigate-in-page') as Event & { url: string };
    duplicateInPageNavigation.url = 'https://example.com';
    flushSync(() => webview.dispatchEvent(duplicateInPageNavigation));

    const changedInPageNavigation = new Event('did-navigate-in-page') as Event & { url: string };
    changedInPageNavigation.url = 'https://example.com/pulls';
    flushSync(() => webview.dispatchEvent(changedInPageNavigation));

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'https://example.com');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'https://example.com/pulls');
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it('reports focus entering the webview guest', () => {
    const onFocus = vi.fn();
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    flushSync(() => root?.render(<FocusHarness onFocus={onFocus} />));

    webview.dispatchEvent(new Event('focus'));

    expect(onFocus).toHaveBeenCalledOnce();
  });
});

const Harness = ({ onNavigate }: { onNavigate: (url: string) => void }) => {
  const browser = useEmbeddedBrowser({
    className: 'test-webview',
    onNavigate,
    url: 'https://example.com',
  });
  return (
    <>
      <div ref={browser.hostRef} />
      <button type="button" onClick={browser.goBack}>Back</button>
    </>
  );
};

interface UrlStore {
  getSnapshot: () => string;
  set: (url: string) => void;
  subscribe: (listener: () => void) => () => void;
}

const createUrlStore = (initialUrl: string): UrlStore => {
  let url = initialUrl;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => url,
    set: (nextUrl) => {
      url = nextUrl;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

const ExternalStoreHarness = ({ store }: { store: UrlStore }) => {
  const url = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const browser = useEmbeddedBrowser({
    className: 'test-webview',
    onNavigate: store.set,
    url,
  });
  return <div ref={browser.hostRef} />;
};

const TitleHarness = ({ onTitleChange }: { onTitleChange: (title: string) => void }) => {
  const browser = useEmbeddedBrowser({
    className: 'test-webview',
    onTitleChange,
    url: 'https://example.com',
  });
  return <div ref={browser.hostRef} />;
};

const FocusHarness = ({ onFocus }: { onFocus: () => void }) => {
  const browser = useEmbeddedBrowser({
    className: 'test-webview',
    onFocus,
    url: 'https://example.com',
  });
  return <div ref={browser.hostRef} />;
};
