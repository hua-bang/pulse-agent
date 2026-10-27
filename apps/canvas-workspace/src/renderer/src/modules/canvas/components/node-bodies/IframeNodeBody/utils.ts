import type { CanvasNode, IframeNodeData } from '../../../../../types';
import type { LanguageCode } from '../../../../../i18n';
import { BLANK_PAGE_URL } from '../../../../../platform/browser/url';
export { BLANK_PAGE_URL, normalizeUrl } from '../../../../../platform/browser/url';

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

export interface BrowserMetaSyncContext {
  editing: boolean;
  readOnly: boolean;
  node: CanvasNode;
  url: string;
  latestDataRef: { current: IframeNodeData };
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  onPageTitleChange?: (title: string) => void;
}

export function syncBrowserPageTitle(title: string, ctx: BrowserMetaSyncContext): void {
  const rawTitle = sanitizePageTitle(title);
  // Read-only embeds (e.g. the reference-drawer URL preview) never reach the
  // onUpdate path — forward the guest title so the host can persist it.
  if (ctx.readOnly) {
    if (rawTitle) ctx.onPageTitleChange?.(rawTitle);
    return;
  }
  if (ctx.editing) return;
  const nextTitle = ctx.url === BLANK_PAGE_URL && rawTitle === BLANK_PAGE_URL ? 'Blank page' : rawTitle;
  if (!nextTitle || nextTitle === ctx.node.title) return;
  const latestData = ctx.latestDataRef.current;
  if (!shouldSyncIframeTitle(ctx.node.title, latestData, ctx.url)) return;
  const nextData = { ...latestData, pageTitle: nextTitle };
  ctx.latestDataRef.current = nextData;
  ctx.onUpdate(ctx.node.id, { title: nextTitle, data: nextData });
}

export function syncBrowserFavicon(favicons: string[], ctx: BrowserMetaSyncContext): void {
  if (ctx.editing || ctx.readOnly) return;
  const faviconUrl = pickFaviconUrl(favicons);
  if (!faviconUrl) return;
  const latestData = ctx.latestDataRef.current;
  if (latestData.faviconUrl === faviconUrl) return;
  const nextData = { ...latestData, faviconUrl };
  ctx.latestDataRef.current = nextData;
  ctx.onUpdate(ctx.node.id, { data: nextData });
}

// Kept out of the shared message table: that table ships in the startup
// bundle, and only the lazy web card shows these.
const loadErrorCopy = {
  en: {
    blocked: 'This site does not allow embedded previews. Open it in your browser to view the page.',
    unreachable: 'The page could not be reached from this network.',
  },
  zh: {
    blocked: '此网站不允许嵌入预览，请在浏览器中打开查看。',
    unreachable: '当前网络无法访问此网页。',
  },
};

/** One plain sentence for the error card, or null for the card's generic
 *  message. The card already says the node stays on the canvas, so the
 *  message does not repeat that. */
export function getFriendlyLoadErrorMessage(
  errorDescription: string | undefined,
  errorCode: number | undefined,
  language: LanguageCode,
): string | null {
  const copy = language === 'zh' ? loadErrorCopy.zh : loadErrorCopy.en;
  const normalized = (errorDescription || '').toUpperCase();
  if (
    normalized.includes('ERR_BLOCKED_BY_RESPONSE')
    || normalized.includes('ERR_BLOCKED_BY_CLIENT')
    || normalized.includes('ERR_BLOCKED_BY_CSP')
    || normalized.includes('FRAME')
    || errorCode === -27
  ) {
    return copy.blocked;
  }
  if (
    normalized.includes('ERR_NAME_NOT_RESOLVED')
    || normalized.includes('ERR_INTERNET_DISCONNECTED')
    || normalized.includes('ERR_CONNECTION')
    || normalized.includes('ERR_TUNNEL')
    || normalized.includes('ERR_PROXY')
    || normalized.includes('ERR_TIMED_OUT')
  ) {
    return copy.unreachable;
  }
  return null;
}
