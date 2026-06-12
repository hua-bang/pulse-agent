/**
 * RightDock — the single shell for right-anchored preview panels
 * (artifact preview, link preview). The left side of the workbench is the
 * reference area (ReferenceDrawer); the right side is chat plus this dock.
 *
 * The shell owns everything the individual drawers used to duplicate:
 *  - fixed right-side positioning on the `--layer-dock` layer (above the
 *    floating toolbar / canvas chrome, below search and modal tiers),
 *  - width state with drag-resize, viewport clamping and optional
 *    localStorage persistence,
 *  - slide in/out animations with an `onExited` callback so owners can
 *    keep content mounted during the exit transition,
 *  - ESC-to-close,
 *  - mutual exclusion between panels via `DockCoordinator` — opening one
 *    panel asks the previous one to close.
 *
 * Non-modal by design: no backdrop, the canvas underneath stays
 * interactive. Panels render their own header/body/footer as children.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DockCoordinator } from './dock-coordinator';
import './index.css';

const EXIT_ANIMATION_NAME = 'right-dock-out';

const RightDockContext = createContext<DockCoordinator | null>(null);

export const RightDockProvider = ({ children }: { children: ReactNode }) => {
  const coordinator = useMemo(() => new DockCoordinator(), []);
  return (
    <RightDockContext.Provider value={coordinator}>
      {children}
    </RightDockContext.Provider>
  );
};

const useDockCoordinator = (): DockCoordinator => {
  const coordinator = useContext(RightDockContext);
  if (!coordinator) {
    throw new Error('RightDockPanel must be used within <RightDockProvider>');
  }
  return coordinator;
};

interface RightDockPanelProps {
  /** Stable identity used for dock exclusivity (e.g. 'artifact', 'link'). */
  panelId: string;
  /** Drives enter/exit animation. Keep rendering until `onExited` fires. */
  open: boolean;
  ariaLabel: string;
  /** Extra class on the <aside> so panel content can scope its styles. */
  className?: string;
  defaultWidth: number;
  minWidth: number;
  /** Max width as a fraction of the viewport width. */
  maxViewportRatio: number;
  /** localStorage key for the dragged width; omit to skip persisting. */
  widthStorageKey?: string;
  /** Asks the owner to close (ESC, or evicted by another panel). */
  onCloseRequest: () => void;
  /** Exit animation finished — owner should drop content / unmount. */
  onExited?: () => void;
  children: ReactNode;
}

function readStoredWidth(key: string | undefined): number | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return null;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const RightDockPanel = ({
  panelId,
  open,
  ariaLabel,
  className,
  defaultWidth,
  minWidth,
  maxViewportRatio,
  widthStorageKey,
  onCloseRequest,
  onExited,
  children,
}: RightDockPanelProps) => {
  const coordinator = useDockCoordinator();
  const asideRef = useRef<HTMLElement>(null);

  const clampWidth = useCallback((value: number): number => {
    const viewport = typeof window === 'undefined' ? value : window.innerWidth;
    const max = Math.max(minWidth, Math.round(viewport * maxViewportRatio));
    return Math.min(max, Math.max(minWidth, value));
  }, [minWidth, maxViewportRatio]);

  const [width, setWidth] = useState<number>(() => clampWidth(readStoredWidth(widthStorageKey) ?? defaultWidth));
  const widthRef = useRef(width);
  widthRef.current = width;

  // Keep the latest close callback in a ref so a stale eviction (claimed
  // long ago) still reaches the current handler.
  const onCloseRequestRef = useRef(onCloseRequest);
  onCloseRequestRef.current = onCloseRequest;

  useEffect(() => {
    if (!open) return;
    coordinator.claim({ id: panelId, onEvict: () => onCloseRequestRef.current() });
    return () => coordinator.release(panelId);
  }, [open, panelId, coordinator]);

  // ESC asks the owner to close. Bound only while showing so ESC stays
  // free for everything else.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRequestRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Re-clamp on viewport resize so a stored width wider than the new
  // viewport doesn't push the panel off-screen.
  useEffect(() => {
    const onResize = () => setWidth((prev) => clampWidth(prev));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampWidth]);

  // Drag the left edge to resize. Lock body cursor + selection during the
  // drag and tear listeners down on mouseup.
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;

    const onMouseMove = (ev: MouseEvent) => {
      // Handle sits on the LEFT edge of a right-anchored panel, so
      // dragging left grows the panel.
      setWidth(clampWidth(startWidth + (startX - ev.clientX)));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (widthStorageKey) {
        try {
          window.localStorage.setItem(widthStorageKey, String(widthRef.current));
        } catch {
          /* localStorage may be unavailable; preference simply won't persist. */
        }
      }
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [clampWidth, widthStorageKey]);

  // The exit animation runs `forwards` and parks the panel off-screen;
  // notify the owner once it finishes so it can unmount the content.
  // Animations bubble from children, so gate on name + target.
  const handleAnimationEnd = useCallback((e: React.AnimationEvent<HTMLElement>) => {
    if (open) return;
    if (e.target !== asideRef.current) return;
    if (e.animationName !== EXIT_ANIMATION_NAME) return;
    onExited?.();
  }, [open, onExited]);

  return (
    <aside
      ref={asideRef}
      className={className ? `right-dock ${className}` : 'right-dock'}
      data-state={open ? 'open' : 'closing'}
      role="dialog"
      aria-label={ariaLabel}
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
      {children}
    </aside>
  );
};
