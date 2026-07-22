// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddedWebviewTag } from '../../EmbeddedBrowser/types';
import type { IframeApi } from '../../../types/iframe';
import {
  useDockWebviewBackgroundLifecycle,
  useDockWebviewDiscard,
} from '../useDockWebviewLifecycle';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const iframeApi = {
  setFrameRate: vi.fn(async () => ({ ok: true })),
  setLifecycle: vi.fn<
    Parameters<IframeApi['setLifecycle']>,
    ReturnType<IframeApi['setLifecycle']>
  >(
    async (_workspaceId, _tabId, state) => ({ ok: true, state }),
  ),
  onDiscarded: vi.fn(),
};

let discardListener: ((payload: {
  workspaceId: string;
  nodeId: string;
  restoreUrl?: string;
  scrollX?: number;
  scrollY?: number;
}) => void) | null = null;
let root: Root | null = null;
let mount: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  discardListener = null;
  iframeApi.onDiscarded.mockImplementation((listener) => {
    discardListener = listener;
    return () => { discardListener = null; };
  });
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: { iframe: iframeApi },
  });
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
  vi.useRealTimers();
});

describe('right-dock webview lifecycle', () => {
  it('throttles an inactive tab, freezes it after the grace period, and resumes on activation', async () => {
    const webview = document.createElement('div') as unknown as EmbeddedWebviewTag;
    const Harness = ({ active }: { active: boolean }) => {
      useDockWebviewBackgroundLifecycle({
        webview,
        workspaceId: 'ws',
        tabId: 'link:tab',
        enabled: true,
        active,
        freezeDelayMs: 5_000,
      });
      return null;
    };

    await act(async () => root?.render(<Harness active={false} />));
    expect(iframeApi.setFrameRate).toHaveBeenCalledWith('ws', 'link:tab', 1);

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(iframeApi.setLifecycle).toHaveBeenCalledWith('ws', 'link:tab', 'frozen');

    await act(async () => root?.render(<Harness active />));
    expect(iframeApi.setLifecycle).toHaveBeenCalledWith('ws', 'link:tab', 'active');
    expect(iframeApi.setFrameRate).toHaveBeenCalledWith('ws', 'link:tab', 60);
  });

  it('rechecks an always-active guest in case its current URL changes while inactive', async () => {
    iframeApi.setLifecycle.mockResolvedValue({
      ok: false,
      retryable: true,
      skipped: 'always-active',
    });
    const webview = document.createElement('div') as unknown as EmbeddedWebviewTag;
    const Harness = () => {
      useDockWebviewBackgroundLifecycle({
        webview,
        workspaceId: 'ws',
        tabId: 'link:tab',
        enabled: true,
        active: false,
        freezeDelayMs: 5_000,
      });
      return null;
    };

    await act(async () => root?.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(iframeApi.setLifecycle).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(iframeApi.setLifecycle).toHaveBeenCalledTimes(2);
  });

  it('keeps a discarded tab unmounted until activation and preserves its restore target', async () => {
    let latest: ReturnType<typeof useDockWebviewDiscard> | null = null;
    const Harness = ({ active }: { active: boolean }) => {
      latest = useDockWebviewDiscard({
        workspaceId: 'ws',
        tabId: 'link:tab',
        enabled: true,
        active,
        tabUrl: 'https://example.com/original',
      });
      return null;
    };

    await act(async () => root?.render(<Harness active={false} />));
    act(() => discardListener?.({
      workspaceId: 'ws',
      nodeId: 'link:tab',
      restoreUrl: 'https://example.com/live',
      scrollX: 5,
      scrollY: 900,
    }));
    expect(latest).toMatchObject({
      discarded: true,
      restore: { url: 'https://example.com/live', scrollX: 5, scrollY: 900 },
    });

    await act(async () => root?.render(<Harness active />));
    expect(latest).toMatchObject({
      discarded: false,
      restore: { url: 'https://example.com/live', scrollX: 5, scrollY: 900 },
    });
  });
});
