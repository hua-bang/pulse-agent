const CANVAS_ROUTE = '/';

export function buildCanvasNodeLink(workspaceId: string, nodeId: string): string {
  const url = new URL(window.location.href);
  const params = new URLSearchParams({ workspaceId, nodeId });
  url.hash = `${CANVAS_ROUTE}?${params.toString()}`;
  return url.toString();
}

/**
 * Navigate to an in-app route whose QUERY has to survive the hash router.
 *
 * wouter's hash `navigate` splits its argument at the first `?` and writes the
 * query to `location.search`, while `currentHashLocation()` reads back only
 * the hash — so a query handed to `setLocation` is dropped before `App`'s
 * `parseCanvasLocation` ever sees it, and the route lands with empty params.
 * Writing the hash ourselves keeps the query where the parser looks, matching
 * the shape `buildCanvasNodeLink` already produces.
 *
 * Re-navigating to the identical hash is a no-op by design: the user is
 * already on that exact route, and the browser raises no `hashchange` for it.
 */
export function navigateCanvasRoute(route: string): void {
  window.location.hash = route.startsWith('/') ? route : `/${route}`;
}

export function parseCanvasLocation(location: string): {
  path: string;
  params: URLSearchParams;
} {
  const [rawPath, rawQuery = ''] = location.split('?');
  return {
    path: rawPath || CANVAS_ROUTE,
    params: new URLSearchParams(rawQuery),
  };
}
