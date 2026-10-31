import { lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import type { NavItem } from '../../../../../plugins/types';
import type { FolderEntry, WorkspaceEntry } from '../../../shared/workspaces';
import type { McpAppEntrypointListing } from '../../../../../shared/mcp-apps';
import {
  AppLogoIcon,
  ChevronRightIcon,
  KnowledgeStoreIcon,
  NodeGraphIcon,
  PluginIcon,
  ScheduledIcon,
  SettingsIcon,
  WorkspaceIcon,
} from '../../../components/icons';
import { useI18n } from '../../../i18n';
import { AppsSection } from './AppsSection';
// Loaded on first hover, so the flyout stays out of the startup bundle.
const WorkspaceFlyout = lazy(() => import('./WorkspaceFlyout'));

/** What the narrow rail's workspace flyout lists and opens. */
interface WorkspaceFlyoutData {
  workspaces: WorkspaceEntry[];
  folders: FolderEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Creates an untitled workspace and opens it. */
  onCreate: () => void;
}

interface SidebarRailProps {
  activeView: string;
  panelCollapsed: boolean;
  onTogglePanel: () => void;
  /** Wide rail: a label beside each icon. */
  expanded: boolean;
  onToggleExpanded: () => void;
  onEnterHome: () => void;
  onEnterCanvas: () => void;
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
  /** The workspace tree the wide rail shows under its destinations. */
  tree?: ReactNode;
  /** Workspaces listed on hover over the narrow rail's Workspaces icon. */
  workspaceFlyout: WorkspaceFlyoutData;
}

interface RailButtonProps {
  active: boolean;
  label: string;
  title?: string;
  /** Keep the label for assistive tech only, even on the wide rail. */
  iconOnly?: boolean;
  onClick: () => void;
  children: ReactNode;
}

const RailButton = ({ active, label, title, iconOnly, onClick, children }: RailButtonProps) => (
  <button
    type="button"
    className={`sidebar-rail-btn${active ? ' sidebar-rail-btn--active' : ''}`}
    onClick={onClick}
    title={title ?? label}
    aria-label={label}
    aria-current={active ? 'page' : undefined}
  >
    {children}
    {!iconOnly && <span className="sidebar-rail-label">{label}</span>}
  </button>
);

/**
 * The always-visible app rail: one icon per top-level destination, with
 * the label toggle and Settings pinned to the bottom. The workspace panel
 * beside it collapses; the rail never does, but it can widen to show labels
 * and the workspace tree.
 */
export const SidebarRail = ({
  activeView,
  panelCollapsed,
  onTogglePanel,
  expanded,
  onToggleExpanded,
  onEnterHome,
  onEnterCanvas,
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
  tree,
  workspaceFlyout,
}: SidebarRailProps) => {
  const { t } = useI18n();
  // null until the first hover, so the lazy flyout loads only when used.
  const [flyoutHovered, setFlyoutHovered] = useState<boolean | null>(null);
  const flyoutAnchorRef = useRef<HTMLSpanElement>(null);
  // The wide rail already lists workspaces, so only the narrow rail hovers.
  const flyoutEnabled = !expanded;
  // Pulse Agent is one destination: the launcher, plus the chat page that
  // its questions and recent chats open. On the canvas the Workspaces icon
  // opens or closes the panel; elsewhere it returns to the canvas.
  const handleWorkspaces = activeView === 'canvas' ? onTogglePanel : onEnterCanvas;

  return (
    <nav className="sidebar-rail" aria-label={t('sidebar.railLabel')}>
      <RailButton
        active={activeView === 'home' || activeView === 'chat'}
        label={t('sidebar.aiChat')}
        title={t('sidebar.aiChatTitle')}
        onClick={onEnterHome}
      >
        <AppLogoIcon size={18} />
      </RailButton>
      <span
        ref={flyoutAnchorRef}
        onMouseEnter={() => setFlyoutHovered(true)}
        onMouseLeave={() => setFlyoutHovered(false)}
      >
        <RailButton
          active={activeView === 'canvas'}
          label={t('sidebar.workspaces')}
          // The flyout names the destination, so skip the native tooltip.
          title={flyoutEnabled
            ? ''
            : activeView === 'canvas' ? t(panelCollapsed ? 'sidebar.expand' : 'sidebar.collapse') : undefined}
          onClick={handleWorkspaces}
        >
          <WorkspaceIcon size={16} />
        </RailButton>
      </span>
      {flyoutEnabled && flyoutHovered !== null && (
        <Suspense fallback={null}>
          <WorkspaceFlyout {...workspaceFlyout} anchorRef={flyoutAnchorRef} triggerHovered={flyoutHovered} />
        </Suspense>
      )}
      {nodesEnabled && (
        <RailButton
          active={activeView === 'nodes' || activeView === 'node-detail' || activeView === 'graph'}
          label={t('sidebar.nodes')}
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
      {tree}
      <div className="sidebar-rail-spacer" />
      <div className="sidebar-rail-footer">
        <RailButton
          active={false}
          label={t(expanded ? 'sidebar.hideLabels' : 'sidebar.showLabels')}
          iconOnly
          onClick={onToggleExpanded}
        >
          <ChevronRightIcon size={12} className="sidebar-rail-chevron" />
        </RailButton>
        <RailButton
          active={activeView === 'settings'}
          label={t('sidebar.settings')}
          onClick={onOpenAppSettings}
        >
          <SettingsIcon size={15} strokeWidth={1.4} />
        </RailButton>
      </div>
    </nav>
  );
};
