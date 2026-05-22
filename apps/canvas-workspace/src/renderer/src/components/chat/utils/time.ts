/**
 * Compact relative time for chat message hover tooltips.
 *
 *  < 1m   → "just now"
 *  < 1h   → "{n}m ago"
 *  < 24h  → "{n}h ago"
 *  < 7d   → "{n}d ago"
 *  older  → locale date (e.g. "May 21")
 *
 * `now` is injected so callers can re-render against a stable clock.
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diffMs = Math.max(0, now - ts);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/** Long, locale-formatted timestamp for the `title` attribute. */
export function formatAbsoluteTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  return new Date(ts).toLocaleString();
}
