// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../types';
import { useIframeNodeState } from './useIframeNodeState';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    MockIntersectionObserver.instances.push(this);
  }

  trigger(isIntersecting: boolean): void {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

const iframeNode: CanvasNode = {
  id: 'node-1',
  type: 'iframe',
  title: 'Example',
  x: 0,
  y: 0,
  width: 640,
  height: 420,
  data: {
    mode: 'url',
    url: 'https://example.com/',
  },
};

type DiscardPayload = {
  workspaceId: string;
  nodeId: string;
  snapshotDataUrl?: string;
  restoreUrl?: string;
  scrollX?: number;
  scrollY?: number;
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let registerWebview: ReturnType<typeof vi.fn>;
let unregisterWebview: ReturnType<typeof vi.fn>;
let setFrameRate: ReturnType<typeof vi.fn>;
let createElementSpy: { mockRestore: () => void };
let originalIntersectionObserver: typeof IntersectionObserver | undefined;
let mockWebview: (HTMLElement & { executeJavaScript: ReturnType<typeof vi.fn> }) | null;
let discardCallback: ((payload: DiscardPayload) => void) | null;
let hookState: ReturnType<typeof useIframeNodeState> | null = null;

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  originalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

  registerWebview = vi.fn().mockResolvedValue({ ok: true });
  unregisterWebview = vi.fn().mockResolvedValue({ ok: true });
  setFrameRate = vi.fn().mockResolvedValue({ ok: true });
  mockWebview = null;
  discardCallback = null;
  hookState = null;
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      iframe: {
        registerWebview,
        unregisterWebview,
        setFrameRate,
        onDiscarded: (cb: (payload: DiscardPayload) => void) => {
          discardCallback = cb;
          return () => {
            discardCallback = null;
          };
        },
      },
    },
  });

  const originalCreateElement = document.createElement.bind(document);
  createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    if (tagName.toLowerCase() !== 'webview') {
      return originalCreateElement(tagName, options);
    }

    const el = originalCreateElement('div') as unknown as HTMLElement & {
      getWebContentsId: () => number;
      reload: () => void;
      executeJavaScript: ReturnType<typeof vi.fn>;
    };
    el.getWebContentsId = () => 123;
    el.reload = vi.fn();
    el.executeJavaScript = vi.fn().mockResolvedValue(undefined);
    mockWebview = el;
    return el;
  }) as typeof document.createElement);
});

afterEach(() => {
  if (root) {
    flushSync(() => root?.unmount());
  }
  host?.remove();
  root = null;
  host = null;
  createElementSpy.mockRestore();
  if (originalIntersectionObserver) {
    globalThis.IntersectionObserver = originalIntersectionObserver;
  } else {
    Reflect.deleteProperty(globalThis, 'IntersectionObserver');
  }
  Reflect.deleteProperty(window, 'canvasWorkspace');
});

describe('useIframeNodeState', () => {
  it('registers the webview after deferred visible mount', async () => {
    await renderHookHarness();

    expect(registerWebview).not.toHaveBeenCalled();

    flushSync(() => {
      for (const observer of MockIntersectionObserver.instances) observer.trigger(true);
    });
    await flushEffects();

    expect(registerWebview).toHaveBeenCalledWith('workspace-1', 'node-1', 123);

    mockWebview?.dispatchEvent(new Event('dom-ready'));
    expect(registerWebview).toHaveBeenLastCalledWith('workspace-1', 'node-1', 123, true);
  });

  it('discard unregisters with the webContentsId; wake remounts on the restore url and scrolls back', async () => {
    await renderHookHarness();
    flushSync(() => {
      for (const observer of MockIntersectionObserver.instances) observer.trigger(true);
    });
    await flushEffects();
    expect(discardCallback).not.toBeNull();

    // Main's L3 sweep picked this node: the webview must unmount and the
    // generation-safe unregister must carry the id that was registered.
    flushSync(() => {
      discardCallback?.({
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        snapshotDataUrl: 'data:image/png;snap',
        restoreUrl: 'https://example.com/deep/page',
        scrollX: 0,
        scrollY: 640,
      });
    });
    await flushEffects();
    expect(hookState?.webviewDiscarded).toBe(true);
    expect(unregisterWebview).toHaveBeenCalledWith('workspace-1', 'node-1', 123);
    const discardedWebview = mockWebview;

    // Wake: the remounted webview loads the freeze-time guest url (NOT the
    // node's saved url) …
    flushSync(() => hookState?.wakeWebview());
    await flushEffects();
    expect(mockWebview).not.toBe(discardedWebview);
    expect(mockWebview?.getAttribute('src')).toBe('https://example.com/deep/page');

    // … and scrolls back once the guest is ready.
    mockWebview?.dispatchEvent(new Event('dom-ready'));
    expect(mockWebview?.executeJavaScript).toHaveBeenCalledWith('window.scrollTo(0, 640)');
  });

  it('ignores discard notifications for other nodes', async () => {
    await renderHookHarness();
    flushSync(() => {
      for (const observer of MockIntersectionObserver.instances) observer.trigger(true);
    });
    await flushEffects();

    flushSync(() => {
      discardCallback?.({ workspaceId: 'workspace-1', nodeId: 'other-node', snapshotDataUrl: 'x' });
    });
    await flushEffects();
    expect(hookState?.webviewDiscarded).toBe(false);
    expect(unregisterWebview).not.toHaveBeenCalled();
  });
});

async function renderHookHarness(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  flushSync(() => {
    root?.render(<IframeHookHarness />);
  });
  await flushEffects();
}

function IframeHookHarness() {
  const state = useIframeNodeState({
    node: iframeNode,
    workspaceId: 'workspace-1',
    onUpdate: vi.fn(),
    readOnly: false,
  });
  hookState = state;

  return <div ref={state.webviewHostRef} />;
}

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
