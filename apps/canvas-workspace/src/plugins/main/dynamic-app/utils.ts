/**
 * Strip `?query` / `#fragment` from a request URL before route matching.
 *
 * Manager's route regexes (`/ui/<id>`, `/api/<id>`, …) anchor on `$`,
 * and `dynamic_app_update` appends a `?v=<timestamp>` cache-buster so
 * the iframe reloads. The raw `req.url` therefore wouldn't match unless
 * we trim the suffix first.
 */
export function stripRequestQuery(rawUrl: string): string {
  const at = rawUrl.search(/[?#]/);
  return at === -1 ? rawUrl : rawUrl.slice(0, at);
}
