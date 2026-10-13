import type { ReactNode } from 'react';
import type { NavItem } from '../../../../../plugins/types';
import type { McpAppEntrypointListing } from '../../../../../shared/mcp-apps';
import {
  AppLogoIcon,
  HomeIcon,
  KnowledgeStoreIcon,
  NodeGraphIcon,
  PluginIcon,
  ScheduledIcon,
  SettingsIcon,
  WorkspaceIcon,
} from '../../../components/icons';
import { useI18n } from '../../../i18n';
import { AppsSection } from './AppsSection';

interface SidebarRailProps {
  activeView: string;
  panelCollapsed: boolean;
  onTogglePanel: () => void;
  onEnterHome: () => void;
  onEnterCanvas: () => void;
  onEnterChat: () => void;
  onEnterNodes: () => void;
  onEnterGraph: () => void;
  onEnterSkills: () => void;
  onEnterScheduled: () => void;
  onOpenAppSettings: () => void;
  nodesEnabled: boolean;
  graphEnabled: boolean;
  enableSkills: boolean;
  enableScheduled: boolean;
  pluginNavItems: ReadonlyArray<NavItem>;
  onNavigate: (path: string) => void;
  activeMcpAppKey: string | null;
  onOpenMcpApp?: (listing: McpAppEntrypointListing) => void;
}

interface RailButtonProps {
  active: boolean;
  label: string;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}

const RailButton = ({ active, label, title, onClick, children }: RailButtonProps) => (
  <button
    type="button"
    className={`sidebar-rail-btn${active ? ' sidebar-rail-btn--active' : ''}`}
    onClick={onClick}
    title={title ?? label}
    aria-label={label}
    aria-current={active ? 'page' : undefined}
  >
    {children}
  </button>
);

/**
 * The always-visible app rail: one icon per top-level destination, with
 * Settings pinned to the bottom. The workspace panel beside it collapses;
 * the rail never does.
 */
export const SidebarRail = ({
  activeView,
  panelCollapsed,
  onTogglePanel,
  onEnterHome,
  onEnterCanvas,
  onEnterChat,
  onEnterNodes,
  onEnterGraph,
  onEnterSkills,
  onEnterScheduled,
  onOpenAppSettings,
  nodesEnabled,
  graphEnabled,
  enableSkills,
  enableScheduled,
  pluginNavItems,
  onNavigate,
  activeMcpAppKey,
  onOpenMcpApp,
}: SidebarRailProps) => {
  const { t } = useI18n();
  // On the canvas the Workspaces icon opens or closes the panel; elsewhere it
  // returns to the canvas.
  const handleWorkspaces = activeView === 'canvas' ? onTogglePanel : onEnterCanvas;

  return (
    <nav className="sidebar-rail" aria-label={t('sidebar.railLabel')}>
      <RailButton active={activeView === 'home'} label={t('sidebar.home')} onClick={onEnterHome}>
        <HomeIcon size={16} />
      </RailButton>
      <RailButton
        active={activeView === 'canvas'}
        label={t('sidebar.workspaces')}
        title={activeView === 'canvas' ? t(panelCollapsed ? 'sidebar.expand' : 'sidebar.collapse') : undefined}
        onClick={handleWorkspaces}
      >
        <WorkspaceIcon size={16} />
      </RailButton>
      <RailButton
        active={activeView === 'chat'}
        label={t('sidebar.aiChat')}
        title={t('sidebar.aiChatTitle')}
        onClick={onEnterChat}
      >
        <AppLogoIcon size={20} />
      </RailButton>
      {nodesEnabled && (
        <RailButton
          active={activeView === 'nodes' || activeView === 'node-detail'}
          label={t('sidebar.nodes')}
          title={t('sidebar.nodesTitle')}
          onClick={onEnterNodes}
        >
          <KnowledgeStoreIcon size={15} />
        </RailButton>
      )}
      {graphEnabled && (
        <RailButton
          active={activeView === 'graph'}
          label={t('sidebar.graph')}
          title={t('sidebar.graphTitle')}
          onClick={onEnterGraph}
        >
          <NodeGraphIcon size={15} />
        </RailButton>
      )}
      {enableSkills && (
        <RailButton
          active={activeView === 'skills' || activeView === 'plugins'}
          label={t('sidebar.skills')}
          title={t('sidebar.skillsTitle')}
          onClick={onEnterSkills}
        >
          <PluginIcon size={15} />
        </RailButton>
      )}
      {enableScheduled && (
        <RailButton
          active={activeView === 'scheduled' || activeView === 'scheduled-task'}
          label={t('sidebar.scheduled')}
          title={t('sidebar.scheduledTitle')}
          onClick={onEnterScheduled}
        >
          <ScheduledIcon size={15} />
        </RailButton>
      )}
      {pluginNavItems.map((item) => {
        const Icon = item.icon;
        return (
          <RailButton
            key={item.id}
            active={activeView === item.path}
            label={item.label}
            title={item.title ?? item.label}
            onClick={() => onNavigate(item.path)}
          >
            {Icon ? <Icon size={15} /> : item.label.slice(0, 1)}
          </RailButton>
        );
      })}
      {onOpenMcpApp && (
        <AppsSection activeView={activeView} activeAppKey={activeMcpAppKey} onOpenApp={onOpenMcpApp} />
      )}
      <div className="sidebar-rail-spacer" />
      <RailButton
        active={activeView === 'settings'}
        label={t('sidebar.openSettings')}
        title={t('sidebar.settings')}
        onClick={onOpenAppSettings}
      >
        <SettingsIcon size={15} strokeWidth={1.4} />
      </RailButton>
    </nav>
  );
};
