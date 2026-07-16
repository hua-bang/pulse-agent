import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useDragResize } from '../ui';
import { useI18n } from '../../i18n';
import { AppLogoIcon } from '../icons';
import { CHAT_TAB_ID, DockStore, isTerminalTabId, type DockState } from './dock-store';
import { LinkTabIcon } from './LinkTabIcon';
import { TerminalDockTab } from './TerminalDockTab';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { useConsumePendingLinks } from '../../hooks/useConsumePendingLinks';
import { useDockAgentBridge } from './useDockAgentBridge';
import './index.css';
import './terminal-tab.css';

export { CHAT_TAB_ID, TERMINAL_TAB_ID, isTerminalTabId, type DockTerminalTab, type DockTerminalWorkspaceState } from './dock-store';

const WIDTH_STORAGE_KEY = 'canvas-workspace:right-dock-width';
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
const MAX_VIEWPORT_RATIO = 0.95;
const RESIZING_CLASS = 'right-dock-resizing';
const ArtifactTabView = lazy(() => import('../artifacts/ArtifactTabView').then((m) => ({ default: m.ArtifactTabView })));
const LinkTabView = lazy(() => import('../LinkDrawer').then((m) => ({ default: m.LinkTabView })));
const NodeDetailDockTab = lazy(() => import('./NodeDetailDockTab').then((m) => ({ default: m.NodeDetailDockTab })));
const CanvasPreview = lazy(() => import('./CanvasPreview').then((m) => ({ default: m.CanvasPreview })));
const DockCreationControls = lazy(() => import('./DockCreationControls').then((m) => ({ default: m.DockCreationControls })));

interface RightDockContextValue {
  store: DockStore;
  chatHost: HTMLDivElement | null;
  setChatHost: (el: HTMLDivElement | null) => void;
  terminalHost: HTMLDivElement | null;
  setTerminalHost: (el: HTMLDivElement | null) => void;
}

const RightDockContext = createContext<RightDockContextValue | null>(null);

export const RightDockProvider = ({ children }: { children: ReactNode }) => {
  const store = useMemo(() => new DockStore(), []);
  const [chatHost, setChatHost] = useState<HTMLDivElement | null>(null);
  const [terminalHost, setTerminalHost] = useState<HTMLDivElement | null>(null);
  const value = useMemo<RightDockContextValue>(
    () => ({ store, chatHost, setChatHost, terminalHost, setTerminalHost }),
    [store, chatHost, terminalHost],
  );
  return (
    <RightDockContext.Provider value={value}>
      {children}
    </RightDockContext.Provider>
  );
};

const useDockContext = (): RightDockContextValue => {
  const ctx = useContext(RightDockContext);
  if (!ctx) throw new Error('useRightDock must be used within <RightDockProvider>');
  return ctx;
};

/** Dock actions — safe to call from anywhere under the provider. */
export function useRightDock(): {
  openArtifact: (workspaceId: string, artifactId: string) => void;
  openNodeDetail: (workspaceId: string, nodeId: string, title: string) => void;
  openCanvasPreview: (workspaceId: string, title: string) => boolean;
  openLink: (url: string) => void;
  newLink: () => void;
  openChat: () => void;
  toggleChat: () => void;
  openTerminal: () => void;
  newTerminal: () => void;
  toggleTerminal: () => void;
  closeTerminal: (id?: string) => void;
  setTerminalAgentType: (id: string, agentType?: string, workspaceId?: string) => void;
  setMountedWorkspaces: (ids: Iterable<string>) => void;
  collapse: () => void;
  notifyChatActivity: () => void;
} {
  const { store } = useDockContext();
  return useMemo(
    () => ({
      openArtifact: (workspaceId: string, artifactId: string) => store.openArtifact(workspaceId, artifactId),
      openNodeDetail: (workspaceId: string, nodeId: string, title: string) => store.openNodeDetail(workspaceId, nodeId, title),
      openCanvasPreview: (workspaceId: string, title: string) => store.openCanvasPreview(workspaceId, title),
      openLink: (url: string) => store.openLink(url),
      newLink: () => store.newLink(),
      openChat: () => store.openChat(),
      toggleChat: () => store.toggleChat(),
      openTerminal: () => store.openTerminal(),
      newTerminal: () => store.newTerminal(),
      toggleTerminal: () => store.toggleTerminal(),
      closeTerminal: (id?: string) => store.closeTerminal(id),
      setTerminalAgentType: (id: string, agentType?: string, workspaceId?: string) =>
        store.setTerminalAgentType(id, agentType, workspaceId),
      setMountedWorkspaces: (ids: Iterable<string>) => store.setMountedWorkspaces(ids),
      collapse: () => store.collapse(),
      notifyChatActivity: () => store.notifyChatActivity(),
    }),
    [store],
  );
}

/** Reactive dock state (tabs, active tab, expanded, chat unread). */
export function useRightDockState(): DockState {
  const { store } = useDockContext();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** DOM element of the dock's chat pane; Workbench portals ChatPanels into it. */
export function useRightDockChatHost(): HTMLDivElement | null {
  return useDockContext().chatHost;
}

/** DOM element of the dock's terminal pane; Workbench portals workspace terminals into it. */
export function useRightDockTerminalHost(): HTMLDivElement | null {
  return useDockContext().terminalHost;
}

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

interface TabIndicatorState {
  left: number;
  width: number;
  visible: boolean;
}

export const RightDock = ({ activeWorkspaceId, chatTabEnabled, workspaces, onOpenNodePage }: RightDockProps) => {
  const { store, setChatHost, setTerminalHost } = useDockContext();
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
  }, [chatTabEnabled, state.activeTabId, state.tabs, store]);

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
  const terminalPaneActive = state.terminalTabs.some((tab) => tab.id === activePaneId);
  const [width, setWidth] = useState<number>(() => clampWidth(readStoredWidth() ?? DEFAULT_WIDTH));

  const tabsRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [tabIndicator, setTabIndicator] = useState<TabIndicatorState>({
    left: 0,
    width: 0,
    visible: false,
  });

  const registerTab = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element) {
      tabRefs.current.set(id, element);
      return;
    }
    tabRefs.current.delete(id);
  }, []);

  const updateTabIndicator = useCallback(() => {
    const activeTab = activePaneId ? tabRefs.current.get(activePaneId) : null;
    const tabScroll = tabsRef.current;
    if (!tabStripVisible || !activeTab || !tabScroll) {
      setTabIndicator((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }
    const tabRect = activeTab.getBoundingClientRect();
    const scrollRect = tabScroll.getBoundingClientRect();
    const next = {
      left: tabRect.left - scrollRect.left + tabScroll.scrollLeft,
      width: tabRect.width,
      visible: true,
    };
    setTabIndicator((prev) => (
      prev.left === next.left && prev.width === next.width && prev.visible === next.visible
        ? prev
        : next
    ));
  }, [activePaneId, tabStripVisible]);

  useLayoutEffect(() => {
    updateTabIndicator();
  }, [updateTabIndicator, state.tabs, state.terminalTabs, chatTabEnabled, width]);

  useEffect(() => {
    if (!tabStripVisible || !activePaneId) return;
    const activeTab = tabRefs.current.get(activePaneId);
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activePaneId, tabStripVisible, state.tabs, state.terminalTabs]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateTabIndicator);
    const tabsElement = tabsRef.current;
    if (tabsElement) observer.observe(tabsElement);
    for (const tabElement of tabRefs.current.values()) {
      observer.observe(tabElement);
    }
    return () => observer.disconnect();
  }, [updateTabIndicator, state.tabs, state.terminalTabs, chatTabEnabled]);

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
          ref={tabsRef}
          className="right-dock__tab-scroll"
          role="tablist"
          aria-label={t('rightDock.tabs')}
          onScroll={updateTabIndicator}
        >
          <span
            className="right-dock__tab-glider"
            aria-hidden="true"
            data-visible={tabIndicator.visible}
            style={{
              width: tabIndicator.width,
              transform: `translateX(${tabIndicator.left}px)`,
            }}
          />
          {chatTabEnabled && (
            <button
              ref={(element) => registerTab(CHAT_TAB_ID, element)}
              type="button"
              role="tab"
              aria-selected={activePaneId === CHAT_TAB_ID}
              className={`right-dock__tab right-dock__tab--chat${activePaneId === CHAT_TAB_ID ? ' right-dock__tab--active' : ''}`}
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
          {terminalTabsVisible && state.terminalTabs.map((tab) => (
            <TerminalDockTab
              key={tab.id}
              tab={tab}
              active={tab.id === activePaneId}
              registerTab={registerTab}
              onActivate={(id) => store.activate(id)}
              onClose={(id) => store.closeTerminal(id)}
              onRename={(id, title) => store.renameTerminal(id, title)}
            />
          ))}
          {state.tabs.map((tab) => {
            const active = tab.id === activePaneId;
            return (
              <span key={tab.id} className="right-dock__tab-shell">
                <button
                  ref={(element) => registerTab(tab.id, element)}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`right-dock__tab right-dock__tab--with-close${active ? ' right-dock__tab--active' : ''}`}
                  title={tab.title}
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
      <div className="right-dock__panes">
        <div
          ref={setChatHost}
          className={`right-dock__pane right-dock__pane--chat${activePaneId === CHAT_TAB_ID ? ' right-dock__pane--active' : ''}`}
        />
        {terminalHostMounted && (
          <div
            className={`right-dock__pane right-dock__pane--terminal${terminalPaneActive ? ' right-dock__pane--active' : ''}`}
          >
            <div ref={setTerminalHost} className="right-dock__terminal-host" />
          </div>
        )}
        {state.tabs.map((tab) => (
          <div
            key={tab.id}
            className={`right-dock__pane${tab.id === activePaneId ? ' right-dock__pane--active' : ''}`}
          >
            {tab.kind === 'artifact' ? (
              <Suspense fallback={null}>
                <ArtifactTabView
                  workspaceId={tab.workspaceId}
                  artifactId={tab.artifactId}
                  onTitleChange={(title) => store.setTitle(tab.id, title)}
                />
              </Suspense>
            ) : tab.kind === 'node-detail' ? (
              <Suspense fallback={null}>
                <NodeDetailDockTab
                  workspaceId={tab.workspaceId}
                  nodeId={tab.nodeId}
                  onTitleChange={(title) => store.setTitle(tab.id, title)}
                  onOpenPage={() => {
                    onOpenNodePage(tab.workspaceId, tab.nodeId);
                    store.close(tab.id);
                  }}
                />
              </Suspense>
            ) : tab.kind === 'canvas' ? (
              <Suspense fallback={null}>
                <CanvasPreview workspaceId={tab.workspaceId} canvasName={tab.title} rootFolder={workspaces.find((ws) => ws.id === tab.workspaceId)?.rootFolder} />
              </Suspense>
            ) : (
              <Suspense fallback={null}>
                <LinkTabView
                  url={tab.url}
                  tabId={tab.id}
                  activeWorkspaceId={activeWorkspaceId}
                  onTitleChange={(title) => store.setTitle(tab.id, title)}
                  onFaviconChange={(faviconUrl) => store.setFavicon(tab.id, faviconUrl)}
                  onNavigate={(url) => store.navigateLink(tab.id, url)}
                  onRequestClose={() => store.close(tab.id)}
                />
              </Suspense>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
};
