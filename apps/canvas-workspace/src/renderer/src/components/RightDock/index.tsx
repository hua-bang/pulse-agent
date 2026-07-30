import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useDragResize } from '../ui';
import { useI18n } from '../../i18n';
import { AppLogoIcon } from '../icons';
import { CHAT_TAB_ID, isTerminalTabId } from './dock-store';
import { useDockContext, useRightDockState } from './context';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { useConsumePendingLinks } from '../../hooks/useConsumePendingLinks';
import { useDockAgentBridge } from './useDockAgentBridge';
import { SplitViewToggle } from './SplitViewToggle';
import { useDockSplitView } from './useDockSplitView';
import {
  clampDockWidth,
  DOCK_DEFAULT_WIDTH,
  DOCK_MIN_WIDTH,
  resolveDockMaxWidth,
  resolveTabWidth,
} from './dock-width';
import { useDockTabDrag } from './useDockTabDrag';
import { useDockKeyboard } from './useDockKeyboard';
import { FOCUS_DOCK_PAGE_EVENT } from './dock-browser-commands';
import { TabContextMenu } from './TabContextMenu';
import { DockContentTab } from './DockContentTab';
import { linkTabIdForWebContents } from './link-tab-webviews';
import { DockPanes } from './DockPanes';
import { hasDockSplitContentTab } from './dock-split-state';
import { useDockTabIndicator } from './useDockTabIndicator';
import { getDockTabVisualState } from './dock-tab-visual-state';
import { dockPaneElementId, dockTabElementId } from './dock-tab-ids';
import {
  getRovingDockTabId,
  handleDockResizeKeyDown,
  handleDockTabListKeyDown,
} from './dock-accessibility';
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
export { isDockChatTabEnabled, isGlobalChatLauncherVisible } from './dock-chat-availability';

const WIDTH_STORAGE_KEY = 'canvas-workspace:right-dock-width';
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

function readViewportWidth(): number {
  return typeof window === 'undefined' ? 0 : window.innerWidth;
}

function persistWidth(value: number): void {
  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(value));
  } catch {
    /* localStorage may be unavailable; preference simply won't persist. */
  }
}

interface RightDockProps {
  activeWorkspaceId: string;
  /** False until `activeWorkspaceId` has resolved past its mount-time placeholder. */
  activeIdReady: boolean;
  chatTabEnabled: boolean;
  /** Canvas reflows around the dock; library-style routes let it overlay. */
  reserveSpace: boolean;
  /** Cap the rendered width so the route's own content stays usable. Canvas
   *  opts out — see `dock-width.ts`. */
  capWidth: boolean;
  workspaces: WorkspaceEntry[];
  onOpenNodePage: (workspaceId: string, nodeId: string) => void;
}

export const RightDock = ({
  activeWorkspaceId,
  activeIdReady,
  chatTabEnabled,
  reserveSpace,
  capWidth,
  workspaces,
  onOpenNodePage,
}: RightDockProps) => {
  const { store, setChatHost, setTerminalHost, pinUrlReference, addDomSelectionToChat, startSkillChat } = useDockContext();
  const state = useRightDockState();
  const { t } = useI18n();

  useLayoutEffect(() => {
    store.setActiveWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId, store]);

  useEffect(() => {
    // `background` mirrors the user's gesture (⌘/Ctrl+click, middle-click);
    // the opener id is resolved from the guest that raised the link so the
    // new tab lands beside the page it came from.
    return window.canvasWorkspace.link.onOpen(({ url, background, sourceWebContentsId }) => {
      store.openLink(url, {
        background,
        openerTabId: linkTabIdForWebContents(sourceWebContentsId),
      });
    });
  }, [store]);
  useDockAgentBridge(store, state, activeWorkspaceId);

  // Cold start: drain URLs the OS queued before this dock could subscribe.
  // Gated on activeIdReady so the tab lands in the real workspace instead of
  // the mount-time placeholder (see useConsumePendingLinks for why).
  useConsumePendingLinks((url) => store.openLink(url), activeIdReady);

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
  const orderedTabIds = [
    ...(chatTabEnabled ? [CHAT_TAB_ID] : []),
    ...(terminalTabsVisible ? state.terminalTabs.map((tab) => tab.id) : []),
    ...state.tabs.map((tab) => tab.id),
  ];
  const rovingTabId = getRovingDockTabId(orderedTabIds, activePaneId);
  // Two layers on purpose: `chosenWidth` is what the user dragged (persisted),
  // `width` is what this route renders. Switching canvas → page must not
  // rewrite the preference, or a wide canvas dock would be silently lost the
  // first time the user visits the AI Chat page.
  const [chosenWidth, setChosenWidth] = useState<number>(
    () => Math.max(DOCK_MIN_WIDTH, readStoredWidth() ?? DOCK_DEFAULT_WIDTH),
  );
  const [viewportWidth, setViewportWidth] = useState<number>(readViewportWidth);
  const maxWidth = resolveDockMaxWidth(viewportWidth, capWidth);
  const width = clampDockWidth(chosenWidth, viewportWidth, capWidth);
  const tabWidth = resolveTabWidth(orderedTabIds.length, width);
  // Stable identity with live values: `useDockSplitView` keeps this in an
  // effect dep list, and a clamp that changed identity per route would re-run
  // (and re-clamp `chosenWidth`) on every navigation.
  const widthPolicyRef = useRef({ viewportWidth, capWidth });
  widthPolicyRef.current = { viewportWidth, capWidth };
  const clampToPolicy = useCallback((value: number) => clampDockWidth(
    value,
    widthPolicyRef.current.viewportWidth,
    widthPolicyRef.current.capWidth,
  ), []);
  const splitView = useDockSplitView({
    active: splitViewActive,
    dockWidth: width,
    setDockWidth: setChosenWidth,
    clampDockWidth: clampToPolicy,
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
    const onResize = () => setViewportWidth(readViewportWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    // Reflow is a per-route policy (`reserveSpace`), NOT a function of the
    // chat tab: a route without one (the full-page chats) still shows link and
    // artifact tabs here, and gating the inset on `chatTabEnabled` let that
    // dock overlay — and cover — the page it was opened beside.
    const inset = visible && reserveSpace ? `${width}px` : '0px';
    document.documentElement.style.setProperty('--right-dock-inset', inset);
    return () => {
      document.documentElement.style.setProperty('--right-dock-inset', '0px');
    };
  }, [visible, reserveSpace, width]);

  const dockRef = useRef<HTMLElement>(null);
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const tabMenuTab = tabMenu ? state.tabs.find((tab) => tab.id === tabMenu.tabId) : undefined;
  useDockKeyboard({ store, visible, newTabTitle: t('rightDock.newTabTitle'), dockRef });

  // Drag the left edge to resize (shared useDragResize hook). The handle sits
  // on the LEFT edge of the right-anchored dock, so dragging left grows it
  // (invert). The resizing class disables the width/margin transitions so the
  // canvas tracks the handle without rubber-banding; the hook owns the body
  // cursor + selection lock and the move/up listeners.
  const resize = useDragResize({
    axis: 'x',
    value: width,
    min: DOCK_MIN_WIDTH,
    max: maxWidth,
    invert: true,
    onChange: setChosenWidth,
    onDragStart: () => document.documentElement.classList.add(RESIZING_CLASS),
    onDragEnd: (finalWidth) => {
      document.documentElement.classList.remove(RESIZING_CLASS);
      persistWidth(finalWidth);
    },
  });
  return (
    <aside
      ref={dockRef}
      className="right-dock"
      data-expanded={visible}
      role="complementary"
      aria-label={t('rightDock.ariaLabel')}
      style={{ width }}
    >
      <div
        className="right-dock__resize-handle"
        onMouseDown={resize.onMouseDown}
        onKeyDown={(event) => handleDockResizeKeyDown(event, {
          value: width,
          min: DOCK_MIN_WIDTH,
          max: maxWidth,
          onChange: (nextWidth) => {
            setChosenWidth(nextWidth);
            persistWidth(nextWidth);
          },
        })}
        tabIndex={0}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('rightDock.resizePanel')}
        aria-valuemin={DOCK_MIN_WIDTH}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
      />
      <div
        className="right-dock__tabs"
        data-visible={tabStripVisible}
        style={{ '--dock-tab-width': `${tabWidth}px` } as CSSProperties}
      >
        <div
          ref={tabIndicator.tabsRef}
          className="right-dock__tab-scroll"
          data-split={splitViewActive}
          role="tablist"
          aria-multiselectable={splitViewActive || undefined}
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
                    tabIndex={rovingTabId === tab.id ? 0 : -1}
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
          {state.tabs.map((tab) => (
            <DockContentTab
              key={tab.id}
              tab={tab}
              visual={getDockTabVisualState(tab.id, activePaneId, splitTabId)}
              tabIndex={rovingTabId === tab.id ? 0 : -1}
              registerTab={tabIndicator.registerTab}
              onActivate={(id) => store.activate(id)}
              onFocusPage={(id) => window.dispatchEvent(
                new CustomEvent(FOCUS_DOCK_PAGE_EVENT, { detail: { tabId: id } }),
              )}
              onClose={(id) => store.close(id)}
              onContextMenu={(tabId, x, y) => setTabMenu({ tabId, x, y })}
              onDragStart={tabDrag.onDragStart}
              onDragOver={tabDrag.onDragOver}
              onDrop={tabDrag.onDrop}
              onDragEnd={tabDrag.clear}
            />
          ))}
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
        <span data-tooltip={t('rightDock.collapse')} className="right-dock__tooltip-wrapper right-dock__tooltip-wrapper--right">
          <button
            type="button"
            className="right-dock__collapse"
            aria-label={t('rightDock.collapseTitle')}
            title={t('rightDock.collapse')}
            onClick={() => store.collapse()}
          >
            ⇥
          </button>
        </span>
      </div>
      <DockPanes
        store={store}
        state={state}
        activePaneId={activePaneId}
        splitTabId={splitTabId}
        chatTabEnabled={chatTabEnabled}
        splitContentWidth={splitView.contentWidth}
        splitDividerWidth={splitView.dividerWidth}
        splitMinContentWidth={splitView.minContentWidth}
        splitMaxContentWidth={splitView.maxContentWidth}
        onDividerMouseDown={splitView.onDividerMouseDown}
        onDividerKeyDown={splitView.onDividerKeyDown}
        setChatHost={setChatHost}
        setTerminalHost={setTerminalHost}
        terminalHostMounted={terminalHostMounted}
        activeWorkspaceId={activeWorkspaceId}
        workspaces={workspaces}
        onOpenNodePage={onOpenNodePage}
        pinUrlReference={pinUrlReference}
        onAddDomSelectionToChat={addDomSelectionToChat}
        onStartSkillChat={startSkillChat}
      />
      {tabMenu && tabMenuTab && (
        <TabContextMenu
          tab={tabMenuTab}
          tabs={state.tabs}
          store={store}
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => setTabMenu(null)}
        />
      )}
    </aside>
  );
};
