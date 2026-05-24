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
