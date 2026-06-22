import { useEffect, useState } from 'react';
import { NodeTypeIcon } from '../icons';

/**
 * Tab-strip icon for a link preview. Shows the page's own favicon once the
 * webview reports it (so the tab matches the site), and falls back to the
 * generic globe while the icon is still loading or if it fails to load.
 */
export const LinkTabIcon = ({ faviconUrl }: { faviconUrl?: string }) => {
  const [failed, setFailed] = useState(false);
  // A new favicon (e.g. after navigating the preview) gets another chance.
  useEffect(() => setFailed(false), [faviconUrl]);

  if (faviconUrl && !failed) {
    return (
      <img
        className="right-dock__tab-favicon"
        src={faviconUrl}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
      />
    );
  }
  return <NodeTypeIcon type="iframe" size={14} />;
};
