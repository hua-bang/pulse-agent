import { createContext, runInContext, type Context } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import type { EmbeddedWebviewTag } from '../EmbeddedBrowser/types';
import {
  initializeWebviewDiscardTracking,
  inspectWebviewForDiscard,
  restoreWebviewSnapshot,
  type WebviewRestoreSnapshot,
} from './webviewDiscardProbe';

const makeWebview = (overrides: Partial<EmbeddedWebviewTag> = {}) => ({
  executeJavaScript: vi.fn().mockResolvedValue({
    activeEditable: false,
    dirty: false,
    focused: false,
    reloadable: true,
    scrollX: 12,
    scrollY: 420,
    url: 'https://example.com/restored',
  }),
  isCurrentlyAudible: vi.fn().mockReturnValue(false),
  isDevToolsOpened: vi.fn().mockReturnValue(false),
  isLoading: vi.fn().mockReturnValue(false),
  matches: vi.fn().mockReturnValue(false),
  ...overrides,
}) as unknown as EmbeddedWebviewTag;

const createScriptContext = (
  document: Record<string, unknown>,
  href = 'https://example.com/',
): Context => {
  const context = createContext({
    document,
    location: { href },
    scrollX: 0,
    scrollY: 0,
  });
  runInContext('globalThis.window = globalThis', context);
  return context;
};

describe('inspectWebviewForDiscard', () => {
  it('captures navigation and scroll state for a clean background guest', async () => {
    const result = await inspectWebviewForDiscard(makeWebview());

    expect(result).toEqual({
      allowed: true,
      snapshot: {
        scrollX: 12,
        scrollY: 420,
        url: 'https://example.com/restored',
      },
    });
  });

  it.each([
    ['audible', { isCurrentlyAudible: vi.fn().mockReturnValue(true) }],
    ['loading', { isLoading: vi.fn().mockReturnValue(true) }],
    ['devtools', { isDevToolsOpened: vi.fn().mockReturnValue(true) }],
    ['focused-host', { matches: vi.fn().mockReturnValue(true) }],
  ])('protects a %s guest', async (reason, overrides) => {
    await expect(inspectWebviewForDiscard(makeWebview(overrides))).resolves.toEqual({
      allowed: false,
      reason,
    });
  });

  it.each([
    ['dirty-form', { dirty: true, activeEditable: false, focused: false }],
    ['active-editor', { dirty: false, activeEditable: true, focused: false }],
    ['focused-document', { dirty: false, activeEditable: false, focused: true }],
    ['non-reloadable', { dirty: false, activeEditable: false, focused: false, reloadable: false }],
  ])('protects guest document state: %s', async (reason, documentState) => {
    const webview = makeWebview({
      executeJavaScript: vi.fn().mockResolvedValue({
        ...documentState,
        reloadable: 'reloadable' in documentState ? documentState.reloadable : true,
        scrollX: 0,
        scrollY: 0,
        url: 'https://example.com/',
      }),
    });

    await expect(inspectWebviewForDiscard(webview)).resolves.toEqual({
      allowed: false,
      reason,
    });
  });

  it('fails closed when the guest cannot be inspected', async () => {
    const webview = makeWebview({
      executeJavaScript: vi.fn().mockRejectedValue(new Error('detached')),
    });

    await expect(inspectWebviewForDiscard(webview)).resolves.toEqual({
      allowed: false,
      reason: 'probe-failed',
    });
  });

  it('fails closed when a guest script never responds', async () => {
    const webview = makeWebview({
      executeJavaScript: vi.fn(() => new Promise<never>(() => undefined)),
    });

    await expect(inspectWebviewForDiscard(webview, 5)).resolves.toEqual({
      allowed: false,
      reason: 'probe-failed',
    });
  });

  it('detects a changed checkbox created in a different same-origin frame realm', async () => {
    const childRealm = createContext({});
    const childControl = runInContext(`(() => {
      class HTMLInputElement {}
      return Object.assign(new HTMLInputElement(), {
        checked: true,
        defaultChecked: false,
        tagName: 'INPUT',
        type: 'checkbox',
      });
    })()`, childRealm) as Record<string, unknown>;
    const childDocument = {
      activeElement: null,
      defaultView: childRealm,
      querySelector: () => null,
      querySelectorAll: (selector: string) => selector === 'iframe' ? [] : [childControl],
    };
    const topDocument = {
      activeElement: null,
      defaultView: null as Context | null,
      hasFocus: () => false,
      querySelector: () => null,
      querySelectorAll: (selector: string) => selector === 'iframe'
        ? [{ contentDocument: childDocument }]
        : [],
    };
    const context = createScriptContext(topDocument);
    topDocument.defaultView = context;
    runInContext('globalThis.HTMLInputElement = class HTMLInputElement {}; globalThis.HTMLSelectElement = class HTMLSelectElement {}', context);
    const webview = makeWebview({
      executeJavaScript: vi.fn(async (script: string) => runInContext(script, context)),
    });

    await expect(inspectWebviewForDiscard(webview)).resolves.toEqual({
      allowed: false,
      reason: 'dirty-form',
    });
  });

  it('protects a populated about:blank fragment document that cannot be replayed from its URL', async () => {
    const topDocument = {
      activeElement: null,
      body: { attributes: [], children: [{}], textContent: '' },
      defaultView: null as Context | null,
      documentElement: { attributes: [] },
      hasFocus: () => false,
      head: { children: [] },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const context = createScriptContext(topDocument, 'about:blank#runtime-view');
    topDocument.defaultView = context;
    const webview = makeWebview({
      executeJavaScript: vi.fn(async (script: string) => runInContext(script, context)),
    });

    await expect(inspectWebviewForDiscard(webview)).resolves.toEqual({
      allowed: false,
      reason: 'non-reloadable',
    });
  });
});

describe('initializeWebviewDiscardTracking', () => {
  it('tracks edits inside an existing same-origin child frame', async () => {
    const childListeners = new Map<string, (event: unknown) => void>();
    const childDocument = {
      addEventListener: (type: string, listener: (event: unknown) => void) => childListeners.set(type, listener),
      documentElement: {},
      querySelectorAll: () => [],
    };
    const childWindow = { document: childDocument };
    const frameListeners = new Map<string, () => void>();
    const frame = {
      addEventListener: (type: string, listener: () => void) => frameListeners.set(type, listener),
      contentWindow: childWindow,
    };
    const topDocument = {
      addEventListener: vi.fn(),
      documentElement: {},
      querySelectorAll: (selector: string) => selector === 'iframe' ? [frame] : [],
    };
    const context = createScriptContext(topDocument);
    const webview = makeWebview({
      executeJavaScript: vi.fn(async (script: string) => runInContext(script, context)),
    });

    await initializeWebviewDiscardTracking(webview);
    childListeners.get('change')?.({
      composedPath: () => [{ matches: (selector: string) => selector.includes('input') }],
    });

    expect(runInContext('window.__pulseCanvasWebviewDirtySinceReady', context)).toBe(true);
    expect(frameListeners.has('load')).toBe(true);
  });
});

describe('restoreWebviewSnapshot', () => {
  it('restores scroll position after a reloaded guest becomes ready', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue(undefined);
    const snapshot: WebviewRestoreSnapshot = {
      scrollX: 12,
      scrollY: 420,
      url: 'https://example.com/restored',
    };

    await restoreWebviewSnapshot(makeWebview({ executeJavaScript }), snapshot);

    expect(executeJavaScript).toHaveBeenCalledOnce();
    expect(executeJavaScript.mock.calls[0]?.[0]).toContain('12');
    expect(executeJavaScript.mock.calls[0]?.[0]).toContain('420');
  });

  it('times out instead of leaving a guest permanently restoring', async () => {
    const webview = makeWebview({
      executeJavaScript: vi.fn(() => new Promise<never>(() => undefined)),
    });

    await expect(restoreWebviewSnapshot(webview, {
      scrollX: 0,
      scrollY: 0,
      url: 'https://example.com/restored',
    }, 5)).rejects.toThrow(/timed out/i);
  });
});
