import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type Loader<T> = () => Promise<{ default: T }>;

export type PreloadableLazy<T extends ComponentType<any>> = LazyExoticComponent<T> & {
  preload: () => Promise<unknown>;
};

/**
 * `React.lazy` with a `preload()` that fetches the chunk ahead of use. Once
 * the chunk is loaded, the first render resolves at once instead of
 * suspending for a frame, so a page switch shows the page, not its blank
 * fallback. React 18 resolves a lazy component synchronously when its
 * thenable calls back synchronously; a native promise always calls back
 * later.
 */
export const preloadableLazy = <T extends ComponentType<any>>(load: Loader<T>): PreloadableLazy<T> => {
  let loaded: { default: T } | undefined;
  let pending: Promise<{ default: T }> | undefined;

  const preload = () => {
    pending ??= load().then(
      (module) => {
        loaded = module;
        return module;
      },
      (error: unknown) => {
        // Let the next render or preload retry the chunk.
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };

  const Component = lazy(() => {
    if (!loaded) return preload();
    const module = loaded;
    const resolved = { then: (resolve: (value: { default: T }) => void) => resolve(module) };
    return resolved as unknown as Promise<{ default: T }>;
  });
  return Object.assign(Component, { preload });
};

/** Preloads page chunks one at a time while the renderer is idle, after
 * startup, so the first visit to each page does not wait on the network. */
export const preloadWhenIdle = (loaders: Array<() => Promise<unknown>>): void => {
  const queue = [...loaders];
  const schedule = (callback: () => void) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(callback, { timeout: 5000 });
    } else {
      window.setTimeout(callback, 200);
    }
  };
  const next = () => {
    const loader = queue.shift();
    if (!loader) return;
    void loader().catch(() => undefined).finally(() => schedule(next));
  };
  schedule(next);
};
