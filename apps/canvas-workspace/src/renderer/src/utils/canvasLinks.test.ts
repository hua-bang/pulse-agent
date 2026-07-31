// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { navigateCanvasRoute, parseCanvasLocation } from './canvasLinks';

/**
 * wouter's hash router reads the location back out of `location.hash` only
 * (`use-hash-location.js`'s `currentHashLocation`), and `App.tsx` feeds
 * exactly that string to `parseCanvasLocation`. Reproducing it here is what
 * makes these round-trip assertions mean anything: asserting on the helper's
 * own output would have passed for the broken `setLocation` path too.
 */
const routerLocation = (): string => `/${window.location.hash.replace(/^#?\/?/, '')}`;

const paramsAfterNavigating = (route: string): URLSearchParams => {
  navigateCanvasRoute(route);
  return parseCanvasLocation(routerLocation()).params;
};

describe('navigateCanvasRoute', () => {
  /**
   * The scheduled-run toast's fallback target. wouter's `navigate` splits its
   * argument at the first `?` and writes the query to `location.search`, which
   * the hash router never reads back — so `setLocation('/chat?scheduledTask=…')`
   * landed on `/chat` with empty params and the toast action did nothing at all
   * on the AI Chat route.
   */
  it('keeps a route query readable by the hash router', () => {
    const params = paramsAfterNavigating('/chat?scheduledTask=daily-brief');

    expect(parseCanvasLocation(routerLocation()).path).toBe('/chat');
    expect(params.get('scheduledTask')).toBe('daily-brief');
    expect(window.location.search).toBe('');
  });

  it('round-trips a task id that needs encoding', () => {
    const taskId = 'daily brief/&?#';
    const params = paramsAfterNavigating(`/chat?scheduledTask=${encodeURIComponent(taskId)}`);

    expect(params.get('scheduledTask')).toBe(taskId);
  });

  it('normalizes a route given without its leading slash', () => {
    navigateCanvasRoute('chat?scheduledTask=weekly');

    expect(parseCanvasLocation(routerLocation()).path).toBe('/chat');
  });
});
