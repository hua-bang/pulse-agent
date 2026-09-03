import { lazy, Suspense, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import type { WorkspaceEntry } from '../../../../hooks/useWorkspaces';
import { useI18n } from '../../../../i18n';
import { focusActiveDockTarget, focusDockLinkTarget } from './dock-browser-commands';
import { handleDockTabListKeyDown } from './dock-accessibility';
import { hasDockTab } from '../../../../shared/dock/dock-split-state';
import { getDockTabVisualState, type DockTabVisualState } from './dock-tab-visual-state';
import { CHAT_TAB_ID, dockPaneElementId, dockTabElementId } from '../../../../shared/dock/dock-tab-ids';
import type { DockStore } from './dock-store';
import { DockContentTab } from './DockContentTab';
import { DockTabIcon } from './DockTabIcon';
import { SplitViewToggle } from './SplitViewToggle';
import type { DockComparisonPair, DockState } from './dock-types';
import type { DockTabSwitcherItem } from './dock-tab-items';
import type { useDockTabDrag } from './useDockTabDrag';
import type { useDockTabIndicator } from './useDockTabIndicator';

const DockCreationControls = lazy(() => import('./DockCreationControls').then((m) => ({ default: m.DockCreationControls })));
const TerminalDockTab = lazy(() => import('./TerminalDockTab').then((m) => ({ default: m.TerminalDockTab })));
const DockTabSwitcher = lazy(() => import('./DockTabSwitcher').then((m) => ({ default: m.DockTabSwitcher })));

interface Props {
  store: DockStore;
  state: DockState;
  activePaneId: string | null;
  splitTabIds?: Readonly<DockComparisonPair>;
  chatTabEnabled: boolean;
  visible: boolean;
  tabStripVisible: boolean;
  tabWidth: number;
  orderedTabIds: readonly string[];
  rovingTabId?: string;
  chatVisual: DockTabVisualState;
  allTabItems: readonly DockTabSwitcherItem[];
  terminalTabsVisible: boolean;
  tabIndicator: ReturnType<typeof useDockTabIndicator>;
  tabDrag: ReturnType<typeof useDockTabDrag>;
  workspaces: WorkspaceEntry[];
  activeWorkspaceId: string;
  activateFromUser: (tabId: string) => void;
  closeFromUser: (tabId: string) => void;
  setTabMenu: Dispatch<SetStateAction<{ tabId: string; x: number; y: number } | null>>;
  collapseFromUser: () => void;
}

export const DockTabStrip = ({
  store,
  state,
  activePaneId,
  splitTabIds,
  chatTabEnabled,
  visible,
  tabStripVisible,
  tabWidth,
  orderedTabIds,
  rovingTabId,
  chatVisual,
  allTabItems,
  terminalTabsVisible,
  tabIndicator,
  tabDrag,
  workspaces,
  activeWorkspaceId,
  activateFromUser,
  closeFromUser,
  setTabMenu,
  collapseFromUser,
}: Props) => {
  const { t } = useI18n();
  const comparisonActive = Boolean(splitTabIds);
  return (
    <div
      className="right-dock__tabs"
      data-visible={tabStripVisible}
      style={{ '--dock-tab-width': `${tabWidth}px` } as CSSProperties}
    >
      <div
        ref={tabIndicator.tabsRef}
        className="right-dock__tab-scroll"
        data-split={comparisonActive}
        role="tablist"
        aria-multiselectable={comparisonActive || undefined}
        aria-label={t('rightDock.tabs')}
        onScroll={tabIndicator.update}
        onKeyDown={(event) => handleDockTabListKeyDown(
          event,
          orderedTabIds,
          (tabId) => store.activate(tabId),
        )}
      >
        <span
          className="right-dock__tab-glider"
          aria-hidden="true"
          data-visible={tabIndicator.indicator.visible}
          style={{
            width: tabIndicator.indicator.width,
            transform: `translateX(${tabIndicator.indicator.left}px)`,
          }}
        />
        {chatTabEnabled && (
          <button
            ref={(element) => tabIndicator.registerTab(CHAT_TAB_ID, element)}
            type="button"
            id={dockTabElementId(CHAT_TAB_ID)}
            data-dock-tab-id={CHAT_TAB_ID}
            role="tab"
            aria-controls={dockPaneElementId(CHAT_TAB_ID)}
            aria-selected={chatVisual.selected}
            aria-expanded={chatVisual.splitActive ? chatVisual.splitVisible : undefined}
            className={`right-dock__tab right-dock__tab--chat${chatVisual.focused ? ' right-dock__tab--active' : ''}`}
            data-focused={chatVisual.focused}
            data-split-visible={chatVisual.splitVisible}
            data-split-part={chatVisual.splitPart}
            data-unread={state.chatUnread}
            title={t('rightDock.chat')}
            tabIndex={rovingTabId === CHAT_TAB_ID ? 0 : -1}
            onClick={() => store.activate(CHAT_TAB_ID)}
          >
            <DockTabIcon kind="chat" />
            <span className="right-dock__tab-title">{t('rightDock.chat')}</span>
            <span className="right-dock__tab-unread" aria-hidden="true" />
          </button>
        )}
        {terminalTabsVisible && (
          <Suspense fallback={null}>
            {state.terminalTabs.map((tab) => (
              <TerminalDockTab
                key={tab.id}
                tab={tab}
                visual={getDockTabVisualState(tab.id, activePaneId, splitTabIds)}
                tabIndex={rovingTabId === tab.id ? 0 : -1}
                registerTab={tabIndicator.registerTab}
                onActivate={(id) => store.activate(id)}
                onClose={(id) => {
                  store.closeTerminal(id);
                  focusActiveDockTarget(store);
                }}
                onRename={(id, title) => store.renameTerminal(id, title)}
                onDragStart={tabDrag.onDragStart}
                onDragOver={tabDrag.onDragOver}
                onDrop={tabDrag.onDrop}
                onDragEnd={tabDrag.clear}
              />
            ))}
          </Suspense>
        )}
        {state.tabs.map((tab) => (
          <DockContentTab
            key={tab.id}
            tab={tab}
            visual={getDockTabVisualState(tab.id, activePaneId, splitTabIds)}
            tabIndex={rovingTabId === tab.id ? 0 : -1}
            registerTab={tabIndicator.registerTab}
            onActivate={(id) => store.activate(id)}
            onFocusPage={(id) => focusDockLinkTarget({
              workspaceId: state.activeTerminalWorkspaceId,
              tabId: id,
              url: tab.kind === 'link' ? tab.url : '',
            })}
            onClose={closeFromUser}
            onContextMenu={(tabId, x, y) => setTabMenu({ tabId, x, y })}
            onDragStart={tabDrag.onDragStart}
            onDragOver={tabDrag.onDragOver}
            onDrop={tabDrag.onDrop}
            onDragEnd={tabDrag.clear}
          />
        ))}
      </div>
      {allTabItems.length > 1 && (
        <Suspense fallback={null}>
          <DockTabSwitcher items={allTabItems} activeTabId={activePaneId} onActivate={activateFromUser} />
        </Suspense>
      )}
      {visible && (
        <Suspense fallback={null}>
          <DockCreationControls
            store={store}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            showTerminal
            newTabTitle={t('rightDock.newTabTitle')}
            mountedWorkspaceIds={state.mountedWorkspaceIds}
            terminalWorkspaceIds={new Set(Object.keys(state.terminalTabsByWorkspace))}
          />
        </Suspense>
      )}
      {chatTabEnabled && (
        <SplitViewToggle
          store={store}
          active={comparisonActive}
          canOpen={Boolean(activePaneId && activePaneId !== CHAT_TAB_ID && hasDockTab(state, activePaneId))}
        />
      )}
      <span data-tooltip={t('rightDock.collapse')} className="right-dock__tooltip-wrapper right-dock__tooltip-wrapper--right">
        <button
          type="button"
          className="right-dock__collapse"
          aria-label={t('rightDock.collapseTitle')}
          title={t('rightDock.collapse')}
          onClick={collapseFromUser}
        >
          ⇥
        </button>
      </span>
    </div>
  );
};
