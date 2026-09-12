import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../../../i18n';
import { NodeTypeIcon } from '../../../../../components/icons';

/** Title-first overview identity. CSS swaps it once per settled zoom gesture. */
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
  const { t } = useI18n();
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
      : host ?? (mode === 'url' ? t('node.type.webPage') : 'HTML');
  const secondary = primary === host ? null : host;

  return (
    <div className="iframe-overview-badge" aria-hidden="true">
      <span className="iframe-overview-badge-source">
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
        {secondary ? <span className="iframe-overview-badge-host">{secondary}</span> : null}
      </span>
      <span className="iframe-overview-badge-title">{primary}</span>
    </div>
  );
};
