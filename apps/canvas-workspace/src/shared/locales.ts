/**
 * Supported UI locales for Canvas Workspace. Shared between main, preload,
 * and renderer so the three sides agree on the set of valid values without
 * an extra IPC round-trip.
 */

export type SupportedLocale = 'en' | 'zh';

export const SUPPORTED_LOCALES = ['en', 'zh'] as const satisfies readonly SupportedLocale[];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Normalise a free-form locale tag (e.g. from `app.getLocale()` or
 * `navigator.language`) down to a supported locale. Unknown tags fall back
 * to {@link DEFAULT_LOCALE}.
 */
export function normaliseLocale(value: string | undefined | null): SupportedLocale {
  if (!value) return DEFAULT_LOCALE;
  const lower = value.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}
