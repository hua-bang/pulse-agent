/**
 * RightDock — the tabbed right-side panel hosting preview surfaces.
 * The left side of the workbench is the reference area (ReferenceDrawer);
 * the right side is chat (in-flow ChatPanel) plus this dock.
 *
 * Architecture:
 *  - `DockStore` (dock-store.ts) owns the tab list + active tab and the
 *    dedup/replacement policies;
 *  - `RightDockProvider` creates the store; `useRightDock()` exposes the
 *    open actions to any component (chat artifact cards, iframe nodes, …);
 *  - `<RightDock>` renders the dock chrome once (mounted in AppContent):
 *    tab strip, width drag + persistence, slide in/out animations, ESC.
 *    It also feeds intercepted external links (`link:open` IPC) into the
 *    link tab.
 *
 * Non-modal by design: no backdrop, the canvas underneath stays
 * interactive. Sits on `--layer-dock`, above canvas chrome and below
 * search/modal tiers (see the layering scale in styles.css).
 *
 * Tab contents stay mounted while their tab exists and are hidden with
 * `visibility: hidden` instead of `display: none` — collapsing a
 * <webview>'s layout detaches its guest contents in Electron, and keeping
 * artifacts mounted preserves scroll position and rendered mermaid SVG.
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
import { DockStore, type DockState } from './dock-store';
import './index.css';

const EXIT_ANIMATION_NAME = 'right-dock-out';
const WIDTH_STORAGE_KEY = 'canvas-workspace:right-dock-width';
const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 360;
const MAX_VIEWPORT_RATIO = 0.95;

const RightDockContext = createContext<DockStore | null>(null);

export const RightDockProvider = ({ children }: { children: ReactNode }) => {
  const store = useMemo(() => new DockStore(), []);
  return (
    <RightDockContext.Provider value={store}>
      {children}
    </RightDockContext.Provider>
  );
};

const useDockStore = (): DockStore => {
  const store = useContext(RightDockContext);
  if (!store) {
    throw new Error('useRightDock must be used within <RightDockProvider>');
  }
  return store;
};

/** Open actions for the dock — safe to call from anywhere under the provider. */
export function useRightDock(): {
  openArtifact: (workspaceId: string, artifactId: string) => void;
  openLink: (url: string) => void;
} {
  const store = useDockStore();
  return useMemo(
    () => ({
      openArtifact: (workspaceId: string, artifactId: string) => store.openArtifact(workspaceId, artifactId),
      openLink: (url: string) => store.openLink(url),
    }),
    [store],
  );
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
}

export const RightDock = ({ activeWorkspaceId }: RightDockProps) => {
  const store = useDockStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const asideRef = useRef<HTMLElement>(null);

  // External links intercepted by the main process land in the link tab.
  useEffect(() => {
    return window.canvasWorkspace.link.onOpen(({ url }) => store.openLink(url));
  }, [store]);

  const open = state.tabs.length > 0;

  // Retain the last non-empty state while the exit animation plays so tab
  // contents don't vanish mid-slide; cleared in the animationend handler.
  const [retained, setRetained] = useState<DockState | null>(null);
  useEffect(() => {
    if (state.tabs.length > 0) setRetained(state);
  }, [state]);
  const shown = open ? state : retained;

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

  // ESC closes the active tab — the gentlest dismissal: background tabs
  // survive, and the dock slides away once the last tab goes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const activeTabId = store.getSnapshot().activeTabId;
      if (activeTabId) store.close(activeTabId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, store]);

  // Drag the left edge to resize. Lock body cursor + selection during the
  // drag and tear listeners down on mouseup.
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
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        window.localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
      } catch {
        /* localStorage may be unavailable; preference simply won't persist. */
      }
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // The exit animation runs `forwards` and parks the dock off-screen;
  // drop the retained content once it finishes. Animations bubble from
  // children, so gate on name + target.
  const handleAnimationEnd = useCallback((e: React.AnimationEvent<HTMLElement>) => {
    if (open) return;
    if (e.target !== asideRef.current) return;
    if (e.animationName !== EXIT_ANIMATION_NAME) return;
    setRetained(null);
  }, [open]);

  if (!shown) return null;

  return (
    <aside
      ref={asideRef}
      className="right-dock"
      data-state={open ? 'open' : 'closing'}
      role="complementary"
      aria-label="Preview dock"
      style={{ width }}
      onAnimationEnd={handleAnimationEnd}
    >
      <div
        className="right-dock__resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
      />
      <div className="right-dock__tabs" role="tablist">
        {shown.tabs.map((tab) => {
          const active = tab.id === shown.activeTabId;
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
          className="right-dock__close-all"
          aria-label="Close panel"
          title="Close panel"
          onClick={() => store.closeAll()}
        >
          ×
        </button>
      </div>
      <div className="right-dock__panes">
        {shown.tabs.map((tab) => (
          <div
            key={tab.id}
            className={`right-dock__pane${tab.id === shown.activeTabId ? ' right-dock__pane--active' : ''}`}
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
