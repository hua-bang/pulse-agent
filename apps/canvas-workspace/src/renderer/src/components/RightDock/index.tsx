import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { useDragResize } from '../ui';
import { useI18n } from '../../i18n';
import { AppLogoIcon } from '../icons';
import { CHAT_TAB_ID, isTerminalTabId } from './dock-store';
import { useDockContext, useRightDockState } from './context';
import { LinkTabIcon } from './LinkTabIcon';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { useConsumePendingLinks } from '../../hooks/useConsumePendingLinks';
import { useDockAgentBridge } from './useDockAgentBridge';
import { SplitViewToggle } from './SplitViewToggle';
import { useDockSplitView } from './useDockSplitView';
import { useDockTabDrag } from './useDockTabDrag';
import { DockPanes } from './DockPanes';
import { hasDockSplitContentTab } from './dock-split-state';
import { useDockTabIndicator } from './useDockTabIndicator';
import { getDockTabVisualState } from './dock-tab-visual-state';
import './index.css';
import './terminal-tab.css';

export { CHAT_TAB_ID, TERMINAL_TAB_ID, isTerminalTabId, type DockTerminalTab, type DockTerminalWorkspaceState } from './dock-store';
export {
  RightDockProvider,
  useRightDock,
  useRightDockChatHost,
  useRightDockState,
  useRightDockTerminalHost,
} from './context';
export { isDockChatVisible, isDockTerminalVisible } from './dock-visibility';

const WIDTH_STORAGE_KEY = 'canvas-workspace:right-dock-width';
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
const MAX_VIEWPORT_RATIO = 0.95;
const RESIZING_CLASS = 'right-dock-resizing';
const DockCreationControls = lazy(() => import('./DockCreationControls').then((m) => ({ default: m.DockCreationControls })));
const TerminalDockTab = lazy(() => import('./TerminalDockTab').then((m) => ({ default: m.TerminalDockTab })));

function readStoredWidth(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    if (!stored) return null;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function clampWidth(value: number): number {
  const viewport = typeof window === 'undefined' ? value : window.innerWidth;
  const max = Math.max(MIN_WIDTH, Math.round(viewport * MAX_VIEWPORT_RATIO));
  return Math.min(max, Math.max(MIN_WIDTH, value));
}

interface RightDockProps {
  activeWorkspaceId: string;
  chatTabEnabled: boolean;
  workspaces: WorkspaceEntry[];
  onOpenNodePage: (workspaceId: string, nodeId: string) => void;
}

export const RightDock = ({ activeWorkspaceId, chatTabEnabled, workspaces, onOpenNodePage }: RightDockProps) => {
  const { store, setChatHost, setTerminalHost, pinUrlReference, addDomSelectionToChat } = useDockContext();
  const state = useRightDockState();
  const { t } = useI18n();

  useLayoutEffect(() => {
    store.setActiveWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId, store]);

  useEffect(() => {
    return window.canvasWorkspace.link.onOpen(({ url }) => store.openLink(url));
  }, [store]);
  useDockAgentBridge(store, state, activeWorkspaceId);

  // Cold start: drain URLs the OS queued before this dock could subscribe.
  useConsumePendingLinks((url) => store.openLink(url));

  useEffect(() => {
    if (chatTabEnabled) return;
    if (state.splitTabId) store.toggleSplitView();
    if (
      (state.activeTabId === CHAT_TAB_ID || isTerminalTabId(state.activeTabId))
      && state.tabs.length > 0
    ) {
      store.activate(state.tabs[0].id);
      return;
    }
    if (state.activeTabId === CHAT_TAB_ID || isTerminalTabId(state.activeTabId)) {
      store.collapse();
    }
  }, [chatTabEnabled, state.activeTabId, state.splitTabId, state.tabs, store]);

  const hasPreviews = state.tabs.length > 0;
  const terminalTabsVisible = chatTabEnabled && state.terminalTabs.length > 0;
  const terminalHostMounted = chatTabEnabled
    && Object.values(state.terminalTabsByWorkspace).some((workspace) => workspace.tabs.length > 0);
  const tabStripVisible = chatTabEnabled || hasPreviews || terminalTabsVisible;
  const visible = state.expanded && (chatTabEnabled || hasPreviews);
  // While the chat tab is unavailable a transient 'chat' active pointer
  // (route guard hasn't run yet) should highlight nothing.
  const activePaneId = !chatTabEnabled
    && (state.activeTabId === CHAT_TAB_ID || isTerminalTabId(state.activeTabId))
    ? null
    : state.activeTabId;
  const splitTabId = chatTabEnabled ? state.splitTabId : undefined;
  const splitViewActive = Boolean(splitTabId);
  const chatVisual = getDockTabVisualState(CHAT_TAB_ID, activePaneId, splitTabId);
  const [width, setWidth] = useState<number>(() => clampWidth(readStoredWidth() ?? DEFAULT_WIDTH));
  const splitView = useDockSplitView({
    active: splitViewActive,
    dockWidth: width,
    setDockWidth: setWidth,
    clampDockWidth: clampWidth,
  });

  const tabDrag = useDockTabDrag(store);
  const tabIndicator = useDockTabIndicator({
    activeTabId: activePaneId,
    visible: tabStripVisible,
    previewTabs: state.tabs,
    terminalTabs: state.terminalTabs,
    chatTabEnabled,
    dockWidth: width,
  });

  useEffect(() => {
    const onResize = () => setWidth((prev) => clampWidth(prev));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const inset = visible && chatTabEnabled ? `${width}px` : '0px';
    document.documentElement.style.setProperty('--right-dock-inset', inset);
    return () => {
      document.documentElement.style.setProperty('--right-dock-inset', '0px');
    };
  }, [visible, chatTabEnabled, width]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const { activeTabId, terminalTabs } = store.getSnapshot();
      if (terminalTabs.some((tab) => tab.id === activeTabId)) {
        store.closeTerminal(activeTabId);
        return;
      }
      if (activeTabId !== CHAT_TAB_ID) store.close(activeTabId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, store]);

  // Drag the left edge to resize (shared useDragResize hook). The handle sits
  // on the LEFT edge of the right-anchored dock, so dragging left grows it
  // (invert). The resizing class disables the width/margin transitions so the
  // canvas tracks the handle without rubber-banding; the hook owns the body
  // cursor + selection lock and the move/up listeners.
  const maxWidth = typeof window === 'undefined'
    ? width
    : Math.max(MIN_WIDTH, Math.round(window.innerWidth * MAX_VIEWPORT_RATIO));
  const resize = useDragResize({
    axis: 'x',
    value: width,
    min: MIN_WIDTH,
    max: maxWidth,
    invert: true,
    onChange: setWidth,
    onDragStart: () => document.documentElement.classList.add(RESIZING_CLASS),
    onDragEnd: (finalWidth) => {
      document.documentElement.classList.remove(RESIZING_CLASS);
      try {
        window.localStorage.setItem(WIDTH_STORAGE_KEY, String(finalWidth));
      } catch {
        /* localStorage may be unavailable; preference simply won't persist. */
      }
    },
  });
  return (
    <aside
      className="right-dock"
      data-expanded={visible}
      role="complementary"
      aria-label={t('rightDock.ariaLabel')}
      style={{ width }}
    >
      <div
        className="right-dock__resize-handle"
        onMouseDown={resize.onMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('rightDock.resizePanel')}
      />
      <div className="right-dock__tabs" data-visible={tabStripVisible}>
        <div
          ref={tabIndicator.tabsRef}
          className="right-dock__tab-scroll"
          data-split={splitViewActive}
          role="tablist"
          aria-multiselectable={splitViewActive || undefined}
          aria-label={t('rightDock.tabs')}
          onScroll={tabIndicator.update}
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
              role="tab"
              aria-selected={chatVisual.selected}
              aria-expanded={chatVisual.splitActive ? chatVisual.splitVisible : undefined}
              className={`right-dock__tab right-dock__tab--chat${chatVisual.focused ? ' right-dock__tab--active' : ''}`}
              data-focused={chatVisual.focused}
              data-split-visible={chatVisual.splitVisible}
              data-split-part={chatVisual.splitPart}
              data-unread={state.chatUnread}
              title={t('rightDock.chat')}
              onClick={() => store.activate(CHAT_TAB_ID)}
            >
              <span className="right-dock__tab-icon right-dock__tab-icon--chat">
                <AppLogoIcon size={14} />
              </span>
              <span className="right-dock__tab-title">{t('rightDock.chat')}</span>
              <span className="right-dock__tab-unread" aria-hidden="true" />
            </button>
          )}
          {terminalTabsVisible && (
            <Suspense fallback={null}>
              {state.terminalTabs.map((tab) => {
                const visual = getDockTabVisualState(tab.id, activePaneId, splitTabId);
                return (
                  <TerminalDockTab
                    key={tab.id}
                    tab={tab}
                    visual={visual}
                    registerTab={tabIndicator.registerTab}
                    onActivate={(id) => store.activate(id)}
                    onClose={(id) => store.closeTerminal(id)}
                    onRename={(id, title) => store.renameTerminal(id, title)}
                    onDragStart={tabDrag.onDragStart}
                    onDragOver={tabDrag.onDragOver}
                    onDrop={tabDrag.onDrop}
                    onDragEnd={tabDrag.clear}
                  />
                );
              })}
            </Suspense>
          )}
          {state.tabs.map((tab) => {
            const visual = getDockTabVisualState(tab.id, activePaneId, splitTabId);
            return (
              <span
                key={tab.id}
                className="right-dock__tab-shell"
                data-split-visible={visual.splitVisible}
                data-split-part={visual.splitPart}
                onDragOver={(event) => tabDrag.onDragOver(event, tab.id)}
                onDrop={(event) => tabDrag.onDrop(event, tab.id)}
              >
                <button
                  ref={(element) => tabIndicator.registerTab(tab.id, element)}
                  type="button"
                  role="tab"
                  aria-selected={visual.selected}
                  aria-expanded={visual.splitActive ? visual.splitVisible : undefined}
                  className={`right-dock__tab right-dock__tab--with-close${visual.focused ? ' right-dock__tab--active' : ''}`}
                  data-focused={visual.focused}
                  data-split-visible={visual.splitVisible}
                  title={tab.title}
                  draggable
                  onDragStart={(event) => tabDrag.onDragStart(event, tab.id)}
                  onDragEnd={tabDrag.clear}
                  onClick={() => store.activate(tab.id)}
                >
                  {tab.kind === 'link' ? (
                    <span className="right-dock__tab-icon right-dock__tab-icon--link">
                      <LinkTabIcon faviconUrl={tab.faviconUrl} />
                    </span>
                  ) : (
                    <span className={`right-dock__tab-dot right-dock__tab-dot--${tab.kind}`} />
                  )}
                  <span className="right-dock__tab-title">{tab.title}</span>
                </button>
                <button
                  type="button"
                  aria-label={t('rightDock.closeTab', { title: tab.title })}
                  title={t('rightDock.closeTab', { title: tab.title })}
                  className="right-dock__tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    store.close(tab.id);
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
        {visible && (
          <Suspense fallback={null}>
            <DockCreationControls
              store={store}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              showTerminal={chatTabEnabled}
              newTabTitle={t('rightDock.newTabTitle')}
              mountedWorkspaceIds={state.mountedWorkspaceIds}
              terminalWorkspaceIds={new Set(Object.keys(state.terminalTabsByWorkspace))}
            />
          </Suspense>
        )}
        {chatTabEnabled && (
          <SplitViewToggle
            store={store}
            active={splitViewActive}
            canOpen={Boolean(activePaneId && hasDockSplitContentTab(state, activePaneId))}
          />
        )}
        <button
          type="button"
          className="right-dock__collapse"
          aria-label={t('rightDock.collapse')}
          title={t('rightDock.collapseTitle')}
          onClick={() => store.collapse()}
        >
          ⇥
        </button>
      </div>
      <DockPanes
        store={store}
        state={state}
        activePaneId={activePaneId}
        splitTabId={splitTabId}
        splitContentWidth={splitView.contentWidth}
        splitDividerWidth={splitView.dividerWidth}
        onDividerMouseDown={splitView.onDividerMouseDown}
        setChatHost={setChatHost}
        setTerminalHost={setTerminalHost}
        terminalHostMounted={terminalHostMounted}
        activeWorkspaceId={activeWorkspaceId}
        workspaces={workspaces}
        onOpenNodePage={onOpenNodePage}
        pinUrlReference={pinUrlReference}
        onAddDomSelectionToChat={addDomSelectionToChat}
      />
    </aside>
  );
};
