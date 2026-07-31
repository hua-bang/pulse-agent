/**
 * Classification of embedded-webview load failures into the few buckets a
 * user can actually act on. `useEmbeddedBrowser` reports the raw Chromium
 * `errorCode` / `errorDescription` (and, for `render-process-gone`, the exit
 * reason); surfaces map the bucket to their own copy — canvas nodes talk
 * about the saved reference, dock tabs about the tab — so the classifier
 * itself stays copy-free and testable.
 */
import type { BrowserLoadError } from './types';

export type LoadErrorKind = 'blocked' | 'network' | 'crashed' | 'unknown';

/** `render-process-gone` reasons, which arrive in the description field. */
const CRASH_REASONS = new Set([
  'crashed',
  'oom',
  'killed',
  'abnormal-exit',
  'launch-failed',
  'integrity-failure',
]);

const BLOCKED_MARKERS = [
  'ERR_BLOCKED_BY_RESPONSE',
  'ERR_BLOCKED_BY_CLIENT',
  'ERR_BLOCKED_BY_CSP',
  'ERR_BLOCKED_BY_ADMINISTRATOR',
  'X-FRAME-OPTIONS',
  'FRAME',
];

const NETWORK_MARKERS = [
  'ERR_NAME_NOT_RESOLVED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NETWORK_CHANGED',
  'ERR_CONNECTION',
  'ERR_TIMED_OUT',
  'ERR_ADDRESS_UNREACHABLE',
  // Proxy/tunnel failures are what a corporate network or a filtered
  // container actually reports; `ERR_CONNECTION` does not cover them
  // (ERR_TUNNEL_CONNECTION_FAILED does not contain that substring), which
  // left the most common real-world failure classified as "unknown".
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TUNNEL_CONNECTION_FAILED',
];

// net_error_list.h. Kept alongside the string markers because a guest that
// dies mid-navigation can report a code with an empty description.
const BLOCKED_CODES = new Set([-27, -30]);
const NETWORK_CODES = new Set([-7, -21, -105, -106, -109, -111, -118, -130, -137]);

export function classifyLoadError(error: BrowserLoadError | null): LoadErrorKind | null {
  if (!error) return null;
  const description = (error.description ?? '').trim();
  const normalized = description.toUpperCase();
  if (CRASH_REASONS.has(description.toLowerCase())) return 'crashed';
  if (BLOCKED_MARKERS.some((marker) => normalized.includes(marker))) return 'blocked';
  if (NETWORK_MARKERS.some((marker) => normalized.includes(marker))) return 'network';
  if (error.code !== undefined) {
    if (BLOCKED_CODES.has(error.code)) return 'blocked';
    if (NETWORK_CODES.has(error.code)) return 'network';
  }
  return 'unknown';
}

/** Raw Chromium detail worth showing under the friendly message, if any. */
export function loadErrorDetail(error: BrowserLoadError | null): string {
  if (!error) return '';
  const description = (error.description ?? '').trim();
  if (description && error.code !== undefined) return `${description} (${error.code})`;
  if (description) return description;
  return error.code !== undefined ? String(error.code) : '';
}
