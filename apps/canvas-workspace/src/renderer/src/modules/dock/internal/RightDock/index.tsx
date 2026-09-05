import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDragResize } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';
import { CHAT_TAB_ID } from './dock-store';
import { useDockContext, useRightDockState } from './context';
import type { RightDockProps } from './dock-types';
import { useConsumePendingLinks } from '../../../../platform/browser/useConsumePendingLinks';
import { useDockLinkOpens } from './useDockLinkOpens';
import { useDockAgentBridge } from './useDockAgentBridge';
import { useDockSplitView } from './useDockSplitView';
import {
  clampDockWidth,
  DOCK_DEFAULT_WIDTH,
  DOCK_MIN_WIDTH,
  resolveDockMaxWidth,
  resolveTabWidth,
} from './dock-width';
import { useDockTabDrag } from './useDockTabDrag';
import {
  cancelDockPageFocusRequestUnless,
  focusActiveDockTarget,
} from './dock-browser-commands';
import { useDockExternalFocus } from './useDockExternalFocus';
import { getDockTabSwitcherItems } from './dock-tab-items';
import { DockPanes } from './DockPanes';
import { DockTabStrip } from './DockTabStrip';
import { getRenderableComparisonPair } from '../../../../shared/dock/dock-split-state';
import { useDockTabIndicator } from './useDockTabIndicator';
import { getDockTabVisualState } from './dock-tab-visual-state';
import {
  getRovingDockTabId,
  handleDockResizeKeyDown,
} from './dock-accessibility';
import './index.css';
import './terminal-tab.css';

export { CHAT_TAB_ID, TERMINAL_TAB_ID, isTerminalTabId, type DockTerminalTab, type DockTerminalWorkspaceState } from './dock-store';
export {
  RightDockProvider,
  useRightDock,
  useRightDockChatHost,
  useRightDockMcpAppHost,
  useRightDockState,
  useRightDockTerminalHost,
} from './context';
export { isDockChatVisible, isDockTerminalVisible } from './dock-visibility';
export {
  isCanvasTabEditingAllowed,
  isDockChatTabEnabled,
  isGlobalChatLauncherVisible,
} from '../../../../shared/dock/dock-chat-availability';
export { useChatDockWorkspace } from './useChatDockWorkspace';

const WIDTH_STORAGE_KEY = 'canvas-workspace:right-dock-width';
const RESIZING_CLASS = 'right-dock-resizing';
const DockKeyboardController = lazy(() => import('./DockKeyboardController').then((m) => ({ default: m.DockKeyboardController })));
const TabContextMenu = lazy(() => import('./TabContextMenu').then((m) => ({ default: m.TabContextMenu })));

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

export const RightDock = ({
  activeWorkspaceId,
  activeIdReady,
  chatTabEnabled,
  reserveSpace,
  capWidth,
  canvasTabEditingAllowed = false,
  onCanvasNodesChange,
  onCanvasSelectionChange,
  pageMinAppWidth,
  workspaces,
  onOpenNodePage,
  onActivateWorkspace,
}: RightDockProps) => {
  const { store, setChatHost, setTerminalHost, setMcpAppHost, pinUrlReference,
    addDomSelectionToChat, submitDomReviewComments, addTabToChat, startSkillChat } = useDockContext();
  const state = useRightDockState();
  const { t } = useI18n();

  useLayoutEffect(() => {
    store.setActiveWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId, store]);

  const activateKnownWorkspace = useCallback((workspaceId: string): boolean => {
    if (!onActivateWorkspace || !workspaces.some(workspace => workspace.id === workspaceId)) return false;
    return onActivateWorkspace(workspaceId) !== false;
  }, [onActivateWorkspace, workspaces]);

  useDockLinkOpens(store);
  useDockAgentBridge(store, state, activeWorkspaceId, activateKnownWorkspace);

  // Drain cold-start URLs only after the real active id resolves; see the hook.
  useConsumePendingLinks((url) => store.openLink(url), activeIdReady);

  useEffect(() => {
    if (chatTabEnabled) return;
    if (state.splitTabIds?.includes(CHAT_TAB_ID)) store.toggleSplitView();
    if (state.activeTabId === CHAT_TAB_ID && state.tabs.length > 0) {
      store.activate(state.tabs[0].id);
      if (!state.expanded) store.collapse();
      return;
    }
    if (state.activeTabId === CHAT_TAB_ID) {
      store.collapse();
    }
  }, [chatTabEnabled, state.activeTabId, state.expanded, state.splitTabIds, state.tabs, store]);

  const hasPreviews = state.tabs.length > 0;
  const terminalTabsVisible = state.terminalTabs.length > 0;
  const terminalHostMounted = Object.values(state.terminalTabsByWorkspace).some((workspace) => workspace.tabs.length > 0);
  const tabStripVisible = chatTabEnabled || hasPreviews || terminalTabsVisible;
  const visible = state.expanded && (chatTabEnabled || hasPreviews || terminalTabsVisible);
  // While the chat tab is unavailable a transient 'chat' active pointer
  // (route guard hasn't run yet) should highlight nothing.
  const activePaneId = !chatTabEnabled && state.activeTabId === CHAT_TAB_ID
    ? null
    : state.activeTabId;
  const splitTabIds = getRenderableComparisonPair(state, chatTabEnabled);
  const splitViewActive = Boolean(splitTabIds);
  const chatVisual = getDockTabVisualState(CHAT_TAB_ID, activePaneId, splitTabIds);
  const allTabItems = useMemo(() => getDockTabSwitcherItems(state, {
    chatTabEnabled,
    chatTitle: t('rightDock.chat'),
    terminalTitle: t('workspaceTerminal.title'),
  }), [chatTabEnabled, state.tabs, state.terminalTabs, t]);
  const orderedTabIds = allTabItems.map((tab) => tab.id);
  const rovingTabId = getRovingDockTabId(orderedTabIds, activePaneId);
  // Two layers on purpose: `chosenWidth` is what the user dragged (persisted),
  // `width` is what this route renders. Switching canvas → page must not
  // rewrite the preference, or a wide canvas dock would be silently lost the
  // first time the user visits the AI Chat page.
  const [chosenWidth, setChosenWidth] = useState<number>(
    () => Math.max(DOCK_MIN_WIDTH, readStoredWidth() ?? DOCK_DEFAULT_WIDTH),
  );
  const [viewportWidth, setViewportWidth] = useState<number>(readViewportWidth);
  const maxWidth = resolveDockMaxWidth(viewportWidth, capWidth, pageMinAppWidth);
  const width = clampDockWidth(chosenWidth, viewportWidth, capWidth, pageMinAppWidth);
  const tabWidth = resolveTabWidth(orderedTabIds.length, width);
  // Stable identity with live values: `useDockSplitView` keeps this in an
  // effect dep list, and a clamp that changed identity per route would re-run
  // (and re-clamp `chosenWidth`) on every navigation.
  const widthPolicyRef = useRef({ viewportWidth, capWidth, pageMinAppWidth });
  widthPolicyRef.current = { viewportWidth, capWidth, pageMinAppWidth };
  const clampToPolicy = useCallback((value: number) => clampDockWidth(
    value,
    widthPolicyRef.current.viewportWidth,
    widthPolicyRef.current.capWidth,
    widthPolicyRef.current.pageMinAppWidth,
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
  const focusActiveTarget = useCallback(() => focusActiveDockTarget(store), [store]);
  useDockExternalFocus(dockRef, t('canvas.toolbar.toggleChat'));
  const collapseFromUser = useCallback(() => {
    store.collapse();
    focusActiveDockTarget(store);
  }, [store]);
  const activateFromUser = useCallback((tabId: string) => {
    store.activate(tabId);
    focusActiveDockTarget(store);
  }, [store]);
  const closeFromUser = useCallback((tabId: string) => {
    store.close(tabId);
    focusActiveDockTarget(store);
  }, [store]);
  useEffect(() => {
    const activeLink = state.tabs.find(
      (tab) => tab.id === activePaneId && tab.kind === 'link',
    );
    cancelDockPageFocusRequestUnless(visible && activeLink ? {
      workspaceId: state.activeTerminalWorkspaceId,
      tabId: activeLink.id,
    } : null);
  }, [activePaneId, state.activeTerminalWorkspaceId, state.tabs, visible]);

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
      {visible && (
        <Suspense fallback={null}>
          <DockKeyboardController
            store={store}
            visible={visible}
            newTabTitle={t('rightDock.newTabTitle')}
            dockRef={dockRef}
            orderedTabIds={orderedTabIds}
            onCollapse={collapseFromUser}
          />
        </Suspense>
      )}
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
      <DockTabStrip
        store={store}
        state={state}
        activePaneId={activePaneId}
        splitTabIds={splitTabIds}
        chatTabEnabled={chatTabEnabled}
        visible={visible}
        tabStripVisible={tabStripVisible}
        tabWidth={tabWidth}
        orderedTabIds={orderedTabIds}
        rovingTabId={rovingTabId}
        chatVisual={chatVisual}
        allTabItems={allTabItems}
        terminalTabsVisible={terminalTabsVisible}
        tabIndicator={tabIndicator}
        tabDrag={tabDrag}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activateFromUser={activateFromUser}
        closeFromUser={closeFromUser}
        setTabMenu={setTabMenu}
        collapseFromUser={collapseFromUser}
      />
      <DockPanes
        store={store}
        state={state}
        activePaneId={activePaneId}
        dockVisible={visible}
        splitTabIds={splitTabIds}
        chatTabEnabled={chatTabEnabled}
        canvasTabEditingAllowed={canvasTabEditingAllowed}
        onCanvasNodesChange={onCanvasNodesChange}
        onCanvasSelectionChange={onCanvasSelectionChange}
        splitContentWidth={splitView.contentWidth}
        splitDividerWidth={splitView.dividerWidth}
        splitMinContentWidth={splitView.minContentWidth}
        splitMaxContentWidth={splitView.maxContentWidth}
        onDividerMouseDown={splitView.onDividerMouseDown}
        onDividerKeyDown={splitView.onDividerKeyDown}
        setChatHost={setChatHost}
        setTerminalHost={setTerminalHost}
        setMcpAppHost={setMcpAppHost}
        terminalHostMounted={terminalHostMounted}
        activeWorkspaceId={activeWorkspaceId}
        workspaces={workspaces}
        onOpenNodePage={onOpenNodePage}
        pinUrlReference={pinUrlReference}
        onAddDomSelectionToChat={addDomSelectionToChat}
        onSubmitDomReviewComments={submitDomReviewComments}
        onAddTabToChat={addTabToChat}
        onStartSkillChat={startSkillChat}
        onCloseTab={closeFromUser}
      />
      {tabMenu && tabMenuTab && (
        <Suspense fallback={null}>
          <TabContextMenu
            tab={tabMenuTab}
            tabs={state.tabs}
            store={store}
            x={tabMenu.x}
            y={tabMenu.y}
            onClose={() => setTabMenu(null)}
            onActionComplete={focusActiveTarget}
          />
        </Suspense>
      )}
    </aside>
  );
};
