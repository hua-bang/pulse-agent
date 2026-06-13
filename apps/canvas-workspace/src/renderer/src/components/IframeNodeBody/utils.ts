import type { IframeNodeData } from '../../types';

export const BLANK_PAGE_URL = 'about:blank';

export function normalizeUrl(input: string): string {
  if (!input) return '';
  const lowered = input.toLowerCase();
  if (lowered === 'blank' || lowered === BLANK_PAGE_URL) return BLANK_PAGE_URL;
  if (/^[a-z]+:\/\//i.test(input)) return input;
  if (/^\/\//.test(input)) return `https:${input}`;
  return `https://${input}`;
}

export function prettyTitle(url: string): string {
  if (url === BLANK_PAGE_URL) return 'Blank page';
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url;
  }
}

export function sanitizePageTitle(title: string | undefined): string {
  return (title ?? '').replace(/\s+/g, ' ').trim();
}

export function shouldSyncIframeTitle(title: string, data: IframeNodeData, url: string): boolean {
  const currentTitle = title.trim();
  const urlTitle = url ? prettyTitle(url) : '';
  const previousPageTitle = sanitizePageTitle(data.pageTitle);

  return (
    !currentTitle
    || currentTitle === 'Web'
    || currentTitle === urlTitle
    || (!!previousPageTitle && currentTitle === previousPageTitle)
  );
}

export function pickFaviconUrl(favicons: string[] | undefined): string {
  const candidates = favicons ?? [];
  return candidates.find((item) => {
    try {
      const url = new URL(item);
      return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'data:';
    } catch {
      return false;
    }
  }) ?? '';
}

export function getFriendlyLoadErrorMessage(
  errorDescription: string | undefined,
  errorCode: number | undefined,
): string {
  const description = errorDescription || '';
  const normalized = description.toUpperCase();
  if (
    normalized.includes('ERR_BLOCKED_BY_RESPONSE')
    || normalized.includes('ERR_BLOCKED_BY_CLIENT')
    || normalized.includes('ERR_BLOCKED_BY_CSP')
    || normalized.includes('FRAME')
    || errorCode === -27
  ) {
    return 'This site does not allow embedded previews. The node is still saved as a reference; open it in your browser to view the page.';
  }
  if (
    normalized.includes('ERR_NAME_NOT_RESOLVED')
    || normalized.includes('ERR_INTERNET_DISCONNECTED')
    || normalized.includes('ERR_CONNECTION')
    || normalized.includes('ERR_TIMED_OUT')
  ) {
    return 'The page could not be reached from this network. The node is still saved as a reference.';
  }
  return description
    ? `${description}. The node is still saved as a reference.`
    : 'The embedded page could not be displayed. The node is still saved as a reference.';
}
