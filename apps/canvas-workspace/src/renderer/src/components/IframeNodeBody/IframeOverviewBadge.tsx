import { useEffect, useMemo, useState } from 'react';

/**
 * Overview-zoom identity badge: favicon + title + hostname for url embeds, a
 * code glyph for html/srcdoc ones. Always in the tree but display:none outside
 * `.canvas-transform--overview` (see index.css) so it costs the compositor
 * nothing at working zoom — the CSS swap keeps the semantic-zoom flip
 * per-gesture, exactly like the placeholder it replaces.
 *
 * Layout is two coordinate systems on purpose: the favicon tile is
 * reverse-scaled to a constant on-screen size, while the text label is laid
 * out in card-relative units so it always ellipsises to the card width and
 * never overflows a narrow node (see index.css).
 */
export const IframeOverviewBadge = ({
  mode,
  url,
  title,
  faviconUrl,
}: {
  mode: 'url' | 'html';
  url: string;
  title?: string;
  faviconUrl?: string;
}) => {
  const [faviconFailed, setFaviconFailed] = useState(false);
  // A fresh favicon (after navigating the embed) gets another chance.
  useEffect(() => setFaviconFailed(false), [faviconUrl]);
  const host = useMemo(() => {
    if (mode !== 'url' || !url) return null;
    try {
      return new URL(url).hostname.replace(/^www\./, '') || null;
    } catch {
      return null;
    }
  }, [mode, url]);

  // Prefer the node title as the primary line (it's what tells cards apart when
  // many share a host); fall back to the host, then a generic type label. Skip
  // a title that just echoes the host so the two lines never duplicate.
  const trimmedTitle = title?.trim() || '';
  const primary =
    trimmedTitle && trimmedTitle.toLowerCase() !== (host ?? '').toLowerCase()
      ? trimmedTitle
      : host ?? (mode === 'url' ? 'Web page' : 'HTML');
  const secondary = primary === host ? null : host;

  return (
    <div className="iframe-overview-badge" aria-hidden="true">
      <span className="iframe-overview-badge-tile">
        {mode === 'url' && faviconUrl && !faviconFailed ? (
          <img
            className="iframe-overview-badge-favicon"
            src={faviconUrl}
            loading="lazy"
            onError={() => setFaviconFailed(true)}
            alt=""
          />
        ) : mode === 'url' ? (
          <GlobeIcon />
        ) : (
          <CodeIcon />
        )}
      </span>
      <span className="iframe-overview-badge-label">
        <span className="iframe-overview-badge-title">{primary}</span>
        {secondary ? (
          <span className="iframe-overview-badge-host">{secondary}</span>
        ) : null}
      </span>
    </div>
  );
};

const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.2" />
    <ellipse cx="8" cy="8" rx="2.8" ry="6.2" stroke="currentColor" strokeWidth="1.2" />
    <path d="M2 8h12M2.8 5h10.4M2.8 11h10.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const CodeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
