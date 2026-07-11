// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
