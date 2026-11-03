import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { PluginNavItem } from '../../../../../../plugins/types';
import type { PluginMarketListing } from '../../../../../../shared/plugin-market';
import { Button } from '../../../../components/ui';
import { Popover } from '../../../../components/ui/Popover';
import { useI18n } from '../../../../i18n';
import { GlobalMcpAppTile } from '../../../../modules/mcp-apps/global-apps';
import { useAppShell } from '../../../../shared/appShell';
import './index.css';

interface Props {
  items: ReadonlyArray<PluginNavItem>;
  activeView: string;
  onNavigate: (path: string) => void;
}

interface MenuState {
  x: number;
  y: number;
  item: PluginNavItem;
  /** undefined while loading; null for a plugin with no market listing (built-in). */
  listing?: PluginMarketListing | null;
}

// The market module also holds the lazy Plugins route view, so load it on
// demand to keep it out of the startup bundle.
const loadMarket = () => import('../../../../modules/plugin-market');

/**
 * Plugin-contributed rail entries. The rail lists them flat in the apps
 * group. Right-click an entry to uninstall the plugin behind it.
 */
const PluginNavGroup = ({ items, activeView, onNavigate }: Props) => {
  const { t } = useI18n();
  const { confirm, notify } = useAppShell();
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = (event: ReactMouseEvent, item: PluginNavItem) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, item });
    void loadMarket()
      .then((market) => market.findInstalledListing(item.pluginId))
      .catch(() => null)
      .then((listing) => {
        setMenu((current) => (current?.item === item ? { ...current, listing } : current));
      });
  };

  const uninstall = async (listing: PluginMarketListing) => {
    setMenu(null);
    const accepted = await confirm({
      intent: 'danger',
      title: t('pluginMarket.uninstallTitle', { name: listing.name }),
      description: t('sidebar.pluginNav.uninstallDescription'),
      confirmLabel: t('pluginMarket.uninstall'),
    });
    if (!accepted) return;
    const market = await loadMarket();
    const result = await market.uninstallListing(listing.id);
    notify(result.ok
      ? { tone: 'success', title: t('sidebar.pluginNav.uninstalled', { name: listing.name }) }
      : { tone: 'error', title: t('sidebar.pluginNav.uninstallFailed'), description: result.error });
  };

  const menuListing = menu?.listing;

  return (
    <>
      {items.map((item) => {
        const Icon = item.icon;
        const active = activeView === item.path;
        return (
          <Button
            key={item.id}
            variant="icon"
            className={`sidebar-rail-btn${active ? ' sidebar-rail-btn--active' : ''}`}
            onClick={() => onNavigate(item.path)}
            onContextMenu={(event) => openMenu(event, item)}
            title={item.title ?? item.label}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
          >
            {Icon ? <Icon size={15} /> : <GlobalMcpAppTile title={item.label} size={18} />}
            <span className="sidebar-rail-label">{item.label}</span>
          </Button>
        );
      })}
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="sidebar-layer-context-menu sidebar-plugin-nav-menu">
          <Button
            variant="danger"
            size="sm"
            role="menuitem"
            className="sidebar-plugin-nav-menu__item"
            disabled={!menuListing}
            onClick={() => { if (menuListing) void uninstall(menuListing); }}
          >
            <span>
              {menuListing === null
                ? t('sidebar.pluginNav.builtIn')
                : t('sidebar.pluginNav.uninstall')}
            </span>
          </Button>
        </Popover>
      )}
    </>
  );
};

export default PluginNavGroup;
