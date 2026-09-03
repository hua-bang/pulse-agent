import { useEffect, useMemo, useState } from 'react';
import { NodeTypeIcon } from '../../../../../components/icons';

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
          <NodeTypeIcon type="iframe" size={16} colorize />
        ) : (
          <NodeTypeIcon type="agent" size={16} colorize />
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
