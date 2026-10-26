import { formatRelativeTime as formatAppRelativeTime } from '../../../../utils/relativeTime';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Relative time for chat message hover tooltips, in the app language:
 * "5 minutes ago" / "5分钟前" within a week, then a short date ("May 21").
 *
 * `now` is injected so callers can re-render against a stable clock.
 */
export function formatRelativeTime(ts: number, language: string, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  if (now - ts >= WEEK_MS) {
    return new Date(ts).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en', {
      month: 'short',
      day: 'numeric',
    });
  }
  return formatAppRelativeTime(Math.min(ts, now), language, now);
}

/** Long, locale-formatted timestamp for the `title` attribute. */
export function formatAbsoluteTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  return new Date(ts).toLocaleString();
}
