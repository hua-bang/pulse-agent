import { useSyncExternalStore } from 'react';
import type { HLJSApi } from 'highlight.js';

// highlight.js with the full language set is about 150KB. Markdown previews on
// the canvas render before first paint, and most of them hold no code block,
// so the highlighter loads on first need instead of with the preview chunk.
// A render that runs before the load shows plain code; the hook below lets it
// render again once the highlighter is ready.

let highlighter: HLJSApi | null = null;
let loading: Promise<HLJSApi> | null = null;
let version = 0;
const listeners = new Set<() => void>();

/** Returns the highlighter if it has loaded, or null. */
export const loadedHighlighter = (): HLJSApi | null => highlighter;

/** Loads highlight.js and its languages once. */
export const loadHighlighter = (): Promise<HLJSApi> => {
  loading ??= Promise.all([
    import('highlight.js/lib/core'),
    import('./syntaxHighlightLanguages'),
  ]).then(([core, { syntaxHighlightLanguages }]) => {
    const api = core.default;
    for (const [name, language] of Object.entries(syntaxHighlightLanguages)) {
      api.registerLanguage(name, language);
    }
    highlighter = api;
    version += 1;
    for (const listener of listeners) listener();
    return api;
  });
  return loading;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const currentVersion = () => version;

/** Changes once, when the highlighter loads. Use it as a render dependency. */
export const useHighlighterVersion = (): number => useSyncExternalStore(subscribe, currentVersion);
