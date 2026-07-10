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

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let registerWebview: ReturnType<typeof vi.fn>;
let unregisterWebview: ReturnType<typeof vi.fn>;
let setFrameRate: ReturnType<typeof vi.fn>;
let createElementSpy: { mockRestore: () => void };
let originalIntersectionObserver: typeof IntersectionObserver | undefined;
let mockWebview: HTMLElement | null;

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  originalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

  registerWebview = vi.fn().mockResolvedValue({ ok: true });
  unregisterWebview = vi.fn().mockResolvedValue({ ok: true });
  setFrameRate = vi.fn().mockResolvedValue({ ok: true });
  mockWebview = null;
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      iframe: {
        registerWebview,
        unregisterWebview,
        setFrameRate,
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
    };
    el.getWebContentsId = () => 123;
    el.reload = vi.fn();
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

  return <div ref={state.webviewHostRef} />;
}

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
