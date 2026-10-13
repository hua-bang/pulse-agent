import { useEffect, useMemo } from 'react';
import { useI18n } from '../../../../i18n';
import { Button } from '../../../../components/ui';
import {
  GlobalMcpAppTile,
  globalMcpAppKey,
  globalMcpAppsStore,
  useGlobalMcpApps,
} from '../../../../modules/mcp-apps/global-apps';
import type { McpAppEntrypointListing } from '../../../../../../shared/mcp-apps';
import './index.css';

interface Props {
  activeView: string;
  /** Key of the app the main area shows, or null on any other view. */
  activeAppKey: string | null;
  onOpenApp: (listing: McpAppEntrypointListing) => void;
}

/**
 * OpenAI `global` entrypoints, the counterpart of ChatGPT's sidebar apps,
 * as icons on the app rail. Clicking one shows its single live instance in
 * the main area.
 */
export const AppsSection = ({ activeView, activeAppKey, onOpenApp }: Props) => {
  const { t } = useI18n();
  const { listings, running } = useGlobalMcpApps();

  // No MCP change event reaches the renderer; re-read on every view change,
  // which also covers returning from the Plugins page.
  useEffect(() => {
    void globalMcpAppsStore.refresh();
  }, [activeView]);

  const apps = useMemo(() => {
    const listed = new Set(listings.map(globalMcpAppKey));
    // A running app stays reachable even if its server dropped the entrypoint.
    return [...listings, ...running.filter(app => !listed.has(app.key)).map(app => app.listing)];
  }, [listings, running]);

  if (apps.length === 0) return null;

  return (
    <div className="sidebar-apps-rail" role="group" aria-label={t('sidebar.apps')}>
      {apps.map((listing) => {
        const key = globalMcpAppKey(listing);
        return (
          <Button
            key={key}
            variant="icon"
            className={`sidebar-rail-btn sidebar-apps-rail__btn${key === activeAppKey ? ' sidebar-rail-btn--active' : ''}`}
            onClick={() => onOpenApp(listing)}
            title={listing.title}
            aria-label={listing.title}
          >
            <GlobalMcpAppTile title={listing.title} size={18} icon={listing.icon} />
          </Button>
        );
      })}
    </div>
  );
};
