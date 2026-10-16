// @vitest-environment happy-dom
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preloadableLazy } from './preloadableLazy';
import { runViewTransition, VIEW_TRANSITION_CLASS } from './viewTransition';

const installViewTransition = () => {
  const callbacks: Array<() => void> = [];
  const finishers: Array<() => void> = [];
  const start = vi.fn((callback: () => void) => {
    callbacks.push(callback);
    return { finished: new Promise<void>((resolve) => finishers.push(resolve)) };
  });
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
  return { start, callbacks, finishers };
};

afterEach(() => {
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  document.documentElement.classList.remove(VIEW_TRANSITION_CLASS);
});

describe('runViewTransition', () => {
  it('applies the update at once when view transitions are unavailable', () => {
    const update = vi.fn();
    runViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('runs the update in the transition callback and names groups until it finishes', async () => {
    const { start, callbacks, finishers } = installViewTransition();
    const update = vi.fn();
    runViewTransition(update);
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains(VIEW_TRANSITION_CLASS)).toBe(true);

    callbacks[0]();
    expect(update).toHaveBeenCalledTimes(1);

    finishers[0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.documentElement.classList.contains(VIEW_TRANSITION_CLASS)).toBe(false);
  });

  it('joins a nested call to the running transition', () => {
    const { start, callbacks } = installViewTransition();
    const inner = vi.fn();
    runViewTransition(() => runViewTransition(inner));
    callbacks[0]();
    expect(start).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe('preloadableLazy', () => {
  it('renders a preloaded component in the first commit, without the fallback', async () => {
    const Page = preloadableLazy(async () => ({ default: () => <p>page</p> }));
    await Page.preload();

    const container = document.createElement('div');
    const root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    act(() => {
      root.render(
        <Suspense fallback={<p>loading</p>}>
          <Page />
        </Suspense>,
      );
    });
    expect(container.textContent).toBe('page');
    act(() => root.unmount());
  });

  it('retries the chunk after a failed preload', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ default: () => null });
    const Page = preloadableLazy(load);
    await expect(Page.preload()).rejects.toThrow('offline');
    await expect(Page.preload()).resolves.toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
