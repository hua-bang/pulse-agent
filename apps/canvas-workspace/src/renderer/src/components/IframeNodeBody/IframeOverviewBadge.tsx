import { useEffect, useMemo, useState } from 'react';

/**
 * Overview-zoom identity badge: favicon + hostname for url embeds, a code
 * glyph for html/srcdoc ones. Always in the tree but display:none outside
 * `.canvas-transform--overview` (see index.css) so it costs the compositor
 * nothing at working zoom — the CSS swap keeps the semantic-zoom flip
 * per-gesture, exactly like the placeholder it replaces.
 */
export const IframeOverviewBadge = ({
  mode,
  url,
  faviconUrl,
}: {
  mode: 'url' | 'html';
  url: string;
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
      {host ? <span className="iframe-overview-badge-host">{host}</span> : null}
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
