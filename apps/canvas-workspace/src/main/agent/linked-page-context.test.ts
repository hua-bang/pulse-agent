import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const liveText = vi.hoisted(() => vi.fn());
vi.mock('../webview/registry', () => ({ getNodeRenderedText: liveText }));

import { readIframeContent } from './linked-page-context';

const fetchMock = vi.fn();
const url = 'https://example.invalid/article';

beforeEach(() => {
  liveText.mockReset().mockResolvedValue(null);
  fetchMock.mockReset().mockRejectedValue(new Error('Unexpected fetch in test'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('linked page context', () => {
  it('returns diagnostics for empty and blank URLs without reading a webview or network', async () => {
    expect(await readIframeContent('workspace', 'node', '')).toBe('[empty link node — no URL set]');
    expect(await readIframeContent('workspace', 'node', 'about:blank')).toBe('[blank web page — no content]');
    expect(liveText).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers the live rendered page and preserves its text exactly', async () => {
    liveText.mockResolvedValue('  Content rendered after login\nSecond line  ');
    expect(await readIframeContent('workspace', 'node', url))
      .toBe('  Content rendered after login\nSecond line  ');
    expect(liveText).toHaveBeenCalledWith('workspace', 'node');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to HTTP text and removes non-readable HTML while preserving title and entities', async () => {
    fetchMock.mockResolvedValue(new Response([
      '<html><head><title>Article</title><style>.hidden{display:none}</style></head>',
      '<body><script>unsafe()</script><noscript>hidden fallback</noscript><!-- private comment -->',
      '<h1>Visible</h1><p>A&nbsp;&amp;&nbsp;B &lt;C&gt; &quot;q&quot; &#39;s&#39;</p></body></html>',
    ].join(''), { headers: { 'content-type': 'text/html' } }));

    const text = await readIframeContent('workspace', 'node', url);
    expect(text).toMatch(/^Title: Article\n\n/);
    expect(text).toContain('Visible A & B <C> "q" \'s\'');
    expect(text).not.toMatch(/unsafe|display:none|hidden fallback|private comment|<script|<style/);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'follow', signal: expect.any(AbortSignal) }));
  });

  it('reports HTTP and network failures instead of returning empty content', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503, statusText: 'Unavailable' }));
    expect(await readIframeContent('workspace', 'node', url)).toBe('[fetch failed: HTTP 503 Unavailable]');

    liveText.mockRejectedValueOnce(new Error('webview detached'));
    fetchMock.mockRejectedValueOnce(new Error('network offline'));
    expect(await readIframeContent('workspace', 'node', url)).toBe('[fetch failed: network offline]');
  });

  it('aborts a stalled HTTP request after ten seconds and returns the timeout diagnostic', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = readIframeContent('workspace', 'node', url);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe('[fetch timed out after 10s]');
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
