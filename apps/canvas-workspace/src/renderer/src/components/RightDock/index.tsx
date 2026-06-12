/**
 * RightDock — the right-side panel of the workbench. Its first tab is the
 * pinned chat; preview surfaces (artifacts, intercepted links) open as
 * additional tabs. With no preview tabs the strip is hidden and the dock
 * looks like a plain chat panel.
 *
 * Architecture:
 *  - `DockStore` (dock-store.ts) owns tabs / active pointer / expanded /
 *    chat-unread and the dedup policies;
 *  - `RightDockProvider` creates the store; `useRightDock()` exposes the
 *    actions; `useRightDockState()` subscribes to state;
 *  - the chat pane is a portal outlet: `useRightDockChatHost()` hands its
 *    DOM element to Workbench, which portals its per-workspace ChatPanels
 *    into it — chat logic, sessions and keep-alive stay where they always
 *    lived, only the DOM target moved;
 *  - `<RightDock>` is mounted once (AppContent) and STAYS mounted while
 *    collapsed so chat and preview tabs keep their state.
 *
 * Layout: the dock is a fixed right-side element on `--layer-dock`. On
 * the canvas route (`chatTabEnabled`) it reserves its width through the
 * `--right-dock-inset` custom property consumed by `.app-body`, so it
 * behaves like an in-flow column (the canvas reflows and the floating
 * toolbar stays fully visible). On other routes (/chat, nodes, …) the
 * chat tab is hidden and the dock overlays previews only.
 *
 * Tab contents stay mounted and hide via `visibility` instead of
 * `display: none` — collapsing a <webview>'s layout detaches its guest
 * contents in Electron, and keeping artifacts mounted preserves scroll
 * position and rendered mermaid SVG.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
// Imported from the source modules (not the artifacts barrel): the barrel
// also re-exports chat cards that consume useRightDock from this module,
// which would create an import cycle.
import { ArtifactTabView } from '../artifacts/ArtifactTabView';
import { LinkTabView } from '../LinkDrawer';
import { CHAT_TAB_ID, DockStore, type DockState } from './dock-store';
import './index.css';

export { CHAT_TAB_ID } from './dock-store';

const WIDTH_STORAGE_KEY = 'canvas-workspace:right-dock-width';
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
const MAX_VIEWPORT_RATIO = 0.95;
const RESIZING_CLASS = 'right-dock-resizing';

interface RightDockContextValue {
  store: DockStore;
  chatHost: HTMLDivElement | null;
  setChatHost: (el: HTMLDivElement | null) => void;
}

const RightDockContext = createContext<RightDockContextValue | null>(null);

export const RightDockProvider = ({ children }: { children: ReactNode }) => {
  const store = useMemo(() => new DockStore(), []);
  const [chatHost, setChatHost] = useState<HTMLDivElement | null>(null);
  const value = useMemo<RightDockContextValue>(
    () => ({ store, chatHost, setChatHost }),
    [store, chatHost],
  );
  return (
    <RightDockContext.Provider value={value}>
      {children}
    </RightDockContext.Provider>
  );
};

const useDockContext = (): RightDockContextValue => {
  const ctx = useContext(RightDockContext);
  if (!ctx) {
    throw new Error('useRightDock must be used within <RightDockProvider>');
  }
  return ctx;
};

/** Dock actions — safe to call from anywhere under the provider. */
export function useRightDock(): {
  openArtifact: (workspaceId: string, artifactId: string) => void;
  openLink: (url: string) => void;
  openChat: () => void;
  toggleChat: () => void;
  collapse: () => void;
  notifyChatActivity: () => void;
} {
  const { store } = useDockContext();
  return useMemo(
    () => ({
      openArtifact: (workspaceId: string, artifactId: string) => store.openArtifact(workspaceId, artifactId),
      openLink: (url: string) => store.openLink(url),
      openChat: () => store.openChat(),
      toggleChat: () => store.toggleChat(),
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
  /** Target canvas for the link tab's "add to current canvas" action. */
  activeWorkspaceId: string;
  /** True on the canvas route: shows the pinned chat tab and reserves
   * layout space (in-flow behaviour). Other routes overlay previews only. */
  chatTabEnabled: boolean;
}

export const RightDock = ({ activeWorkspaceId, chatTabEnabled }: RightDockProps) => {
  const { store, setChatHost } = useDockContext();
  const state = useRightDockState();

  // External links intercepted by the main process land in the link tab.
  useEffect(() => {
    return window.canvasWorkspace.link.onOpen(({ url }) => store.openLink(url));
  }, [store]);

  // Route guard: while the chat tab is unavailable, an active 'chat'
  // pointer falls forward to the first preview so the dock never shows an
  // empty pane.
  useEffect(() => {
    if (chatTabEnabled) return;
    if (state.activeTabId === CHAT_TAB_ID && state.tabs.length > 0) {
      store.activate(state.tabs[0].id);
    }
  }, [chatTabEnabled, state.activeTabId, state.tabs, store]);

  const hasPreviews = state.tabs.length > 0;
  const visible = state.expanded && (chatTabEnabled || hasPreviews);

  const [width, setWidth] = useState<number>(() => clampWidth(readStoredWidth() ?? DEFAULT_WIDTH));
  const widthRef = useRef(width);
  widthRef.current = width;

  // Re-clamp on viewport resize so a stored width wider than the new
  // viewport doesn't push the dock off-screen.
  useEffect(() => {
    const onResize = () => setWidth((prev) => clampWidth(prev));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Reserve layout space on the canvas route (in-flow behaviour). The
  // inset lives on <html> so .app-body can consume it from anywhere.
  useEffect(() => {
    const inset = visible && chatTabEnabled ? `${width}px` : '0px';
    document.documentElement.style.setProperty('--right-dock-inset', inset);
    return () => {
      document.documentElement.style.setProperty('--right-dock-inset', '0px');
    };
  }, [visible, chatTabEnabled, width]);

  // ESC closes the active preview tab. Chat is persistent workspace UI and
  // never ESC-closes — same as the old standalone chat panel, and it keeps
  // ESC free for canvas interactions (deselect, exit fullscreen, …).
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const { activeTabId } = store.getSnapshot();
      if (activeTabId !== CHAT_TAB_ID) store.close(activeTabId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, store]);

  // Drag the left edge to resize. Lock body cursor + selection during the
  // drag; the resizing class disables the width/margin transitions so the
  // canvas tracks the handle without rubber-banding.
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;

    const onMouseMove = (ev: MouseEvent) => {
      // Handle sits on the LEFT edge of the right-anchored dock, so
      // dragging left grows it.
      setWidth(clampWidth(startWidth + (startX - ev.clientX)));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.documentElement.classList.remove(RESIZING_CLASS);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        window.localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
      } catch {
        /* localStorage may be unavailable; preference simply won't persist. */
      }
    };

    document.documentElement.classList.add(RESIZING_CLASS);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // While the chat tab is unavailable a transient 'chat' active pointer
  // (route guard hasn't run yet) should highlight nothing.
  const activePaneId = !chatTabEnabled && state.activeTabId === CHAT_TAB_ID ? null : state.activeTabId;

  return (
    <aside
      className="right-dock"
      data-expanded={visible}
      role="complementary"
      aria-label="Chat and preview panel"
      style={{ width }}
    >
      <div
        className="right-dock__resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
      />
      {hasPreviews && (
        <div className="right-dock__tabs" role="tablist">
          {chatTabEnabled && (
            <button
              type="button"
              role="tab"
              aria-selected={activePaneId === CHAT_TAB_ID}
              className={`right-dock__tab right-dock__tab--chat${activePaneId === CHAT_TAB_ID ? ' right-dock__tab--active' : ''}`}
              data-unread={state.chatUnread}
              title="Chat"
              onClick={() => store.activate(CHAT_TAB_ID)}
            >
              <span className="right-dock__tab-dot right-dock__tab-dot--chat" />
              <span className="right-dock__tab-title">Chat</span>
              <span className="right-dock__tab-unread" aria-hidden="true" />
            </button>
          )}
          {state.tabs.map((tab) => {
            const active = tab.id === activePaneId;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`right-dock__tab${active ? ' right-dock__tab--active' : ''}`}
                title={tab.title}
                onClick={() => store.activate(tab.id)}
              >
                <span className={`right-dock__tab-dot right-dock__tab-dot--${tab.kind}`} />
                <span className="right-dock__tab-title">{tab.title}</span>
                <span
                  role="button"
                  aria-label="Close tab"
                  className="right-dock__tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    store.close(tab.id);
                  }}
                >
                  ×
                </span>
              </button>
            );
          })}
          <div className="right-dock__tabs-spacer" />
          <button
            type="button"
            className="right-dock__collapse"
            aria-label="Collapse panel"
            title="Collapse panel (tabs are kept)"
            onClick={() => store.collapse()}
          >
            ⇥
          </button>
        </div>
      )}
      <div className="right-dock__panes">
        {/* Chat pane: portal outlet — always mounted so chat keeps its
            state across collapse, tab switches and route changes. */}
        <div
          ref={setChatHost}
          className={`right-dock__pane right-dock__pane--chat${activePaneId === CHAT_TAB_ID ? ' right-dock__pane--active' : ''}`}
        />
        {state.tabs.map((tab) => (
          <div
            key={tab.id}
            className={`right-dock__pane${tab.id === activePaneId ? ' right-dock__pane--active' : ''}`}
          >
            {tab.kind === 'artifact' ? (
              <ArtifactTabView
                workspaceId={tab.workspaceId}
                artifactId={tab.artifactId}
                onTitleChange={(title) => store.setTitle(tab.id, title)}
              />
            ) : (
              <LinkTabView
                url={tab.url}
                activeWorkspaceId={activeWorkspaceId}
                onTitleChange={(title) => store.setTitle(tab.id, title)}
                onRequestClose={() => store.close(tab.id)}
              />
            )}
          </div>
        ))}
      </div>
    </aside>
  );
};
