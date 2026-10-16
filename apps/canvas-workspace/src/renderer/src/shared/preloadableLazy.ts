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
  // A repeat call reuses the chunk the bundler already loaded.
  const preload = () => load().then((module) => (loaded = module));
  const Component = lazy(() => {
    const module = loaded;
    if (!module) return preload();
    const resolved = { then: (resolve: (value: { default: T }) => void) => resolve(module) };
    return resolved as unknown as Promise<{ default: T }>;
  });
  return Object.assign(Component, { preload });
};

/** Preloads page chunks once the renderer is idle after startup, so the
 * first visit to each page does not wait on the network. */
export const preloadWhenIdle = (loaders: Array<() => Promise<unknown>>): void => {
  // Chromium always has it; test DOMs without it skip the preload.
  window.requestIdleCallback?.(() => {
    for (const load of loaders) void load().catch(() => undefined);
  }, { timeout: 5000 });
};
