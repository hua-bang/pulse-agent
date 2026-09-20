import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => {
  const wc = { id: 41, isDestroyed: vi.fn(() => false), getURL: vi.fn(() => 'https://example.test'), executeJavaScriptInIsolatedWorld: vi.fn() };
  return { wc, current: { value: true }, policy: { allow: true },
    click: vi.fn(), fill: vi.fn(), press: vi.fn(), scroll: vi.fn() };
});
vi.mock('../target', () => ({
  resolvePageControlTarget: vi.fn(async () => ({ ok: true, target: { wc: f.wc, url: f.wc.getURL() } })),
  auditPageAction: vi.fn(),
}));
vi.mock('../../../../main/webview/registry', () => ({
  getWebviewRegistration: () => ({ workspaceId: 'ws', nodeId: 'link:1', webContentsId: 41 }),
  getWebContentsForInstance: () => f.current.value ? f.wc : null,
}));
vi.mock('../../../../main/webview/temporary-active-read', () => ({
  withTemporarilyActiveWebview: (_wc: unknown, _id: number, _identity: unknown, read: () => Promise<unknown>) => read(),
}));
vi.mock('../policy', () => ({ evaluateActionPolicy: () => f.policy }));
vi.mock('../cdp-actions', () => ({ cdpClickSelector: f.click, cdpFillSelector: f.fill, cdpPressKey: f.press }));
vi.mock('../js-primitives', () => ({ scrollPage: f.scroll }));
vi.mock('../../../../main/dock/tab-store', () => ({ getDockTabs: () => [
  { kind: 'link', id: 'link:new', url: 'https://video.test/1', title: 'Video' },
] }));

import { openPageRunBrowser } from './browser';
import { reportPageLinkRequest } from '../../../../main/webview/page-link-events';
import type { PageSnapshot, PageAction } from './types';

const snapshot: PageSnapshot = { id: 's', documentId: 'd', url: 'https://example.test', title: '', text: '', fingerprint: 'f', targets: [], truncated: false, scrollUp: false, scrollDown: false };
const action: PageAction = { id: 'fill_e1', kind: 'fill', description: 'Query', target: {
  ref: 'e1', name: 'Query', role: 'textbox', value: '', operations: ['fill'], checked: null, expanded: null,
} };
beforeEach(() => {
  f.current.value = true;
  f.policy.allow = true;
  f.wc.executeJavaScriptInIsolatedWorld.mockReset().mockResolvedValue({ status: 'ready' });
  f.fill.mockReset().mockResolvedValue({ ok: true });
  f.click.mockReset().mockResolvedValue({ ok: true });
  f.press.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => { vi.useRealTimers(); });

describe('page_run pinned browser adapter', () => {
  it('attributes a popup to this run only after input and only for its exact source', async () => {
    const signal = new AbortController().signal;
    const port = await openPageRunBrowser('ws', 'link:1', signal);
    const source = { workspaceId: 'ws', nodeId: 'link:1', webContentsId: 41 };
    try {
      reportPageLinkRequest(source, 'https://unrelated.test/');
      expect(port.getOpenedPages?.()).toEqual([]);
      f.click.mockImplementation(async (_wc, _selector, guard) => {
        guard.onInput('Input.dispatchMouseEvent', { type: 'mousePressed' });
        reportPageLinkRequest({ ...source, workspaceId: 'other' }, 'https://unrelated.test/');
        reportPageLinkRequest(source, 'https://video.test/1');
        return { ok: true };
      });
      await port.execute({ ...action, kind: 'click' }, snapshot, undefined, signal);
      expect(port.getOpenedPages?.()).toEqual([{ workspaceId: 'ws', nodeId: 'link:new', url: 'https://video.test/1', title: 'Video' }]);
    } finally { port.close(); }
  });

  it('prevents simultaneous runs and never adopts a replacement guest', async () => {
    const signal = new AbortController().signal;
    const port = await openPageRunBrowser('ws', 'link:1', signal);
    try {
      await expect(openPageRunBrowser('ws', 'link:1', signal)).rejects.toThrow('already operating');
      f.current.value = false;
      await expect(port.observe(signal)).rejects.toThrow('closed or replaced');
    } finally { port.close(); }
  });

  it('keeps URL policy active and propagates cancellation before observation', async () => {
    const controller = new AbortController();
    const port = await openPageRunBrowser('ws', 'link:1', controller.signal);
    try {
      f.policy.allow = false;
      await expect(port.observe(controller.signal)).rejects.toThrow('policy blocked');
      f.policy.allow = true;
      controller.abort(new Error('Stopped'));
      await expect(port.observe(controller.signal)).rejects.toThrow('Stopped');
      expect(f.wc.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
    } finally { port.close(); }
  });

  it('uses existing fill without submitting and invalidates late continuations on return', async () => {
    const signal = new AbortController().signal;
    const port = await openPageRunBrowser('ws', 'link:1', signal);
    try {
      await port.execute(action, snapshot, 'Pulse', signal);
      expect(f.fill).toHaveBeenCalledWith(f.wc, expect.stringMatching(/^\[data-pulse-run=/), 'Pulse', expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(f.press).not.toHaveBeenCalled();
      const guard = f.fill.mock.calls[0][3];
      expect(guard.signal.aborted).toBe(true);
      await expect(guard.beforeInput()).rejects.toThrow();
    } finally { port.close(); }
  });

  it('returns a recoverable preparation result after scrolling, before calling click or fill', async () => {
    const signal = new AbortController().signal;
    const port = await openPageRunBrowser('ws', 'link:1', signal);
    try {
      f.wc.executeJavaScriptInIsolatedWorld.mockResolvedValue({ status: 'revealed', reason: 'clipped_by_scroll_container' });
      await expect(port.execute(action, snapshot, 'Pulse', signal)).rejects.toMatchObject({ name: 'PageRunRetry', code: 'clipped_by_scroll_container' });
      expect(f.fill).not.toHaveBeenCalled();
    } finally { port.close(); }
  });

  it('preserves a pre-click stale failure normalized by the CDP primitive', async () => {
    const signal = new AbortController().signal;
    const port = await openPageRunBrowser('ws', 'link:1', signal);
    try {
      f.wc.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce({ status: 'ready' }).mockResolvedValue({ status: 'stale', reason: 'coordinates_changed' });
      f.click.mockImplementation(async (_wc, _selector, guard) => {
        try { await guard.beforeInput('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 10 }); }
        catch { return { ok: false }; }
      });
      await expect(port.execute({ ...action, kind: 'click' }, snapshot, undefined, signal))
        .rejects.toMatchObject({ name: 'PageRunRetry', code: 'coordinates_changed' });
    } finally { port.close(); }
  });

  it('never retries after a field-clear or an input was dispatched', async () => {
    const signal = new AbortController().signal;
    const port = await openPageRunBrowser('ws', 'link:1', signal);
    try {
      f.wc.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce({ status: 'ready' }).mockResolvedValue({ status: 'stale', reason: 'target_replaced' });
      f.fill.mockImplementation(async (_wc, _selector, _text, guard) => {
        guard.onInput('DOM.fill');
        try { await guard.beforeInput('Input.insertText'); }
        catch { return { ok: false }; }
      });
      await expect(port.execute(action, snapshot, 'Pulse', signal)).rejects.toMatchObject({ name: 'PageRunStop', status: 'blocked', code: 'target_replaced' });
    } finally { port.close(); }
  });

  it('returns action_timeout for a hung input while the parent task is still active', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const port = await openPageRunBrowser('ws', 'link:1', parent.signal);
    try {
      f.fill.mockImplementation(() => new Promise(() => {}));
      const result = expect(port.execute(action, snapshot, 'Pulse', parent.signal))
        .rejects.toMatchObject({ status: 'error', code: 'action_timeout' });
      await vi.advanceTimersByTimeAsync(5_001);
      await result;
      expect(parent.signal.aborted).toBe(false);
    } finally { port.close(); }
  });
});

it('binds region scrolling to the observed reference and rejects a stale region before mutation', async () => {
  const signal = new AbortController().signal;
  const browser = await openPageRunBrowser('ws', 'link:1', signal);
  const scrollAction: PageAction = { id: 'scroll_down_e9', kind: 'scroll_down', description: '正文', scrollArea: {
    ref: 'e9', name: '正文', role: 'main', top: 0, height: 500, width: 800, scrollHeight: 2_000, atTop: true, atBottom: false,
  } };
  try {
    f.wc.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, scripts) => {
      const code = scripts[0].code;
      if (code.includes('"mode":"scroll"')) return { status: 'stale', reason: 'scroll_region_replaced' };
      return true;
    });
    await expect(browser.execute(scrollAction, snapshot, undefined, signal)).rejects.toMatchObject({ name: 'PageRunRetry', code: 'scroll_region_replaced' });
    const script = f.wc.executeJavaScriptInIsolatedWorld.mock.calls.find(([, scripts]) => scripts[0].code.includes('"mode":"scroll"'))?.[1][0].code;
    expect(script).toContain('"ref":"e9"');
    expect(f.scroll).not.toHaveBeenCalled();
  } finally { browser.close(); }
});
