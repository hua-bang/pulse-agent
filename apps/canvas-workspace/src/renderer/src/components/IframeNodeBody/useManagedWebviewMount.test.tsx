// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddedWebviewTag } from '../EmbeddedBrowser/types';
import { WebviewLifecycleCoordinator } from './webviewLifecycleCoordinator';
import { useManagedWebviewMount } from './useManagedWebviewMount';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  private target: Element | null = null;

  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }

  observe = vi.fn((target: Element) => {
    this.target = target;
  });

  disconnect = vi.fn();

  trigger(near: boolean, active = near): void {
    const rect = active
      ? { bottom: 100, height: 100, left: 0, right: 200, top: 0, width: 200 }
      : { bottom: 1100, height: 100, left: 0, right: 200, top: 1000, width: 200 };
    this.callback(
      [{
        boundingClientRect: rect,
        isIntersecting: near,
        target: this.target,
      } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  triggerRect(rect: DOMRect | ClientRect, isIntersecting = true): void {
    this.callback(
      [{ boundingClientRect: rect, isIntersecting, target: this.target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let originalIntersectionObserver: typeof IntersectionObserver | undefined;

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  originalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  flushSync(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  if (originalIntersectionObserver) globalThis.IntersectionObserver = originalIntersectionObserver;
  else Reflect.deleteProperty(globalThis, 'IntersectionObserver');
  Reflect.deleteProperty(window, '__pulseWebviewLifecycle');
});

describe('useManagedWebviewMount', () => {
  it('defers the first guest until its host approaches the viewport', async () => {
    const coordinator = new WebviewLifecycleCoordinator({ liveCap: 1, offscreenGraceMs: 0 });
    await render(<Harness coordinator={coordinator} nodeId="node-1" />);

    expect(readState('node-1')).toEqual({ mount: 'false', state: 'deferred' });

    flushSync(() => MockIntersectionObserver.instances[0]?.trigger(true));
    await flushEffects();

    expect(readState('node-1')).toEqual({ mount: 'true', state: 'live' });
  });

  it('discards an old offscreen guest and restores it as a new generation', async () => {
    let now = 0;
    const coordinator = new WebviewLifecycleCoordinator(
      { liveCap: 1, offscreenGraceMs: 0 },
      () => ++now,
    );
    await render(
      <>
        <Harness coordinator={coordinator} nodeId="old" />
        <Harness coordinator={coordinator} nodeId="new" />
      </>,
    );

    flushSync(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
      MockIntersectionObserver.instances[1]?.trigger(true);
    });
    await flushEffects();
    flushSync(() => MockIntersectionObserver.instances[0]?.trigger(false));
    await coordinator.reconcile({ ignoreGrace: true });
    await flushEffects();

    expect(readState('old')).toEqual({ mount: 'false', state: 'discarded' });
    expect(readState('new')).toEqual({ mount: 'true', state: 'live' });

    flushSync(() => MockIntersectionObserver.instances[0]?.trigger(true));
    await flushEffects();

    expect(readState('old')).toEqual({ mount: 'true', state: 'restoring' });
  });

  it('remeasures visibility after zoom even when intersection never crosses zero', async () => {
    const coordinator = new WebviewLifecycleCoordinator({ liveCap: 1, offscreenGraceMs: 0 });
    const rectRef = { current: makeRect(0, 0, 100, 100) };
    await render(
      <div className="canvas-container">
        <div className="canvas-transform">
          <Harness coordinator={coordinator} nodeId="node-1" rectRef={rectRef} />
        </div>
      </div>,
    );

    flushSync(() => MockIntersectionObserver.instances[0]?.triggerRect(rectRef.current, true));
    await flushEffects();
    expect(readState('node-1')).toEqual({ mount: 'false', state: 'deferred' });

    rectRef.current = makeRect(0, 0, 200, 100);
    const transform = document.querySelector('.canvas-transform')!;
    transform.classList.add('canvas-transform--moving');
    transform.classList.remove('canvas-transform--moving');
    await new Promise((resolve) => setTimeout(resolve, 280));
    expect(readState('node-1')).toEqual({ mount: 'true', state: 'live' });
    expect(coordinator.snapshot().entries[0]?.active).toBe(true);

    rectRef.current = makeRect(0, 0, 100, 100);
    transform.classList.add('canvas-transform--moving');
    transform.classList.remove('canvas-transform--moving');
    await new Promise((resolve) => setTimeout(resolve, 280));
    expect(coordinator.snapshot().entries[0]?.active).toBe(false);
  });

  it('uses the clipped canvas viewport instead of the full application window', async () => {
    const coordinator = new WebviewLifecycleCoordinator({ liveCap: 1, offscreenGraceMs: 0 });
    const rectRef = { current: makeRect(750, 0, 200, 100) };
    await render(
      <div
        className="canvas-container"
        ref={(element) => {
          if (element) element.getBoundingClientRect = () => makeRect(0, 0, 500, 500);
        }}
      >
        <Harness coordinator={coordinator} nodeId="clipped" rectRef={rectRef} />
      </div>,
    );

    flushSync(() => MockIntersectionObserver.instances[0]?.triggerRect(rectRef.current, true));
    await flushEffects();

    expect(readState('clipped')).toEqual({ mount: 'false', state: 'deferred' });
    expect(coordinator.snapshot().entries[0]).toMatchObject({ active: false, state: 'deferred' });
  });

  it('keeps a live guest registered when its URL changes', async () => {
    const coordinator = new WebviewLifecycleCoordinator({ liveCap: 1, offscreenGraceMs: 0 });
    await render(<Harness coordinator={coordinator} nodeId="node-1" url="https://example.com/one" />);
    flushSync(() => MockIntersectionObserver.instances[0]?.trigger(true));
    await flushEffects();
    expect(coordinator.snapshot().liveCount).toBe(1);

    flushSync(() => root?.render(
      <Harness coordinator={coordinator} nodeId="node-1" url="https://example.com/two" />,
    ));
    await flushEffects();

    expect(coordinator.snapshot()).toMatchObject({
      liveCount: 1,
      entries: [{ state: 'live', active: true }],
    });
  });

  it('does not discard a guest when canvas motion begins during an async probe', async () => {
    let resolveProbe!: (value: unknown) => void;
    const probe = new Promise((resolve) => {
      resolveProbe = resolve;
    });
    const oldWebview = makeWebview();
    oldWebview.executeJavaScript = vi.fn(() => probe) as EmbeddedWebviewTag['executeJavaScript'];
    let now = 0;
    const coordinator = new WebviewLifecycleCoordinator(
      { liveCap: 1, offscreenGraceMs: 0 },
      () => ++now,
    );
    await render(
      <div className="canvas-container">
        <div className="canvas-transform">
          <Harness coordinator={coordinator} nodeId="old" webview={oldWebview} />
          <Harness coordinator={coordinator} nodeId="new" />
        </div>
      </div>,
    );
    flushSync(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
      MockIntersectionObserver.instances[1]?.trigger(true);
    });
    await flushEffects();
    flushSync(() => MockIntersectionObserver.instances[0]?.trigger(false));

    const reconcile = coordinator.reconcile({ ignoreGrace: true });
    await vi.waitFor(() => expect(oldWebview.executeJavaScript).toHaveBeenCalled());
    document.querySelector('.canvas-transform')?.classList.add('canvas-transform--moving');
    resolveProbe({
      activeEditable: false,
      dirty: false,
      focused: false,
      reloadable: true,
      scrollX: 0,
      scrollY: 40,
      url: 'https://example.com/restored',
    });
    await reconcile;
    await flushEffects();

    expect(readState('old')).toEqual({ mount: 'true', state: 'live' });
    expect(coordinator.snapshot().liveCount).toBe(2);
  });
});

function Harness({
  coordinator,
  nodeId,
  rectRef,
  url,
  webview,
}: {
  coordinator: WebviewLifecycleCoordinator;
  nodeId: string;
  rectRef?: { current: DOMRect };
  url?: string;
  webview?: EmbeddedWebviewTag;
}) {
  const webviewHostRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<EmbeddedWebviewTag>(webview ?? makeWebview());
  const lifecycle = useManagedWebviewMount({
    coordinator,
    enabled: true,
    nodeId,
    protectedState: false,
    url: url ?? `https://example.com/${nodeId}`,
    webviewHostRef,
  });

  useEffect(() => {
    lifecycle.setCurrentWebview(lifecycle.shouldMount ? webviewRef.current : null);
    return () => lifecycle.setCurrentWebview(null);
  }, [lifecycle.setCurrentWebview, lifecycle.shouldMount]);

  return (
    <div ref={(element) => {
      webviewHostRef.current = element;
      if (element && rectRef) element.getBoundingClientRect = () => rectRef.current;
    }}>
      <span
        data-node={nodeId}
        data-mount={String(lifecycle.shouldMount)}
        data-state={lifecycle.state}
      />
    </div>
  );
}

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

const makeWebview = (): EmbeddedWebviewTag => {
  const element = document.createElement('div') as unknown as EmbeddedWebviewTag;
  element.executeJavaScript = vi.fn().mockResolvedValue({
    activeEditable: false,
    dirty: false,
    focused: false,
    reloadable: true,
    scrollX: 0,
    scrollY: 40,
    url: 'https://example.com/restored',
  });
  element.isCurrentlyAudible = vi.fn().mockReturnValue(false);
  element.isDevToolsOpened = vi.fn().mockReturnValue(false);
  element.isLoading = vi.fn().mockReturnValue(false);
  return element;
};

async function render(element: React.ReactNode): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root?.render(element));
  await flushEffects();
}

function readState(nodeId: string): { mount: string | undefined; state: string | undefined } {
  const element = document.querySelector(`[data-node="${nodeId}"]`);
  return {
    mount: element?.getAttribute('data-mount') ?? undefined,
    state: element?.getAttribute('data-state') ?? undefined,
  };
}

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
