// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
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

  it('does not reload a guest when the parent persists a URL reported by did-navigate', () => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    flushSync(() => root?.render(<ControlledHarness />));

    const setAttribute = vi.spyOn(webview, 'setAttribute');
    const event = new Event('did-navigate') as Event & { url: string };
    event.url = 'https://example.com/next';
    flushSync(() => webview.dispatchEvent(event));

    expect(setAttribute).not.toHaveBeenCalledWith('src', 'https://example.com/next');
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

const ControlledHarness = () => {
  const [url, setUrl] = useState('https://example.com');
  const browser = useEmbeddedBrowser({
    className: 'test-webview',
    onNavigate: setUrl,
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
