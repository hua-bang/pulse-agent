import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { EmbeddedWebviewTag } from '../EmbeddedBrowser/types';
import {
  installWebviewLifecycleDebugApi,
  webviewLifecycleCoordinator,
  type WebviewLifecycleCoordinator,
  type WebviewLifecycleHandle,
  type WebviewLifecycleState,
} from './webviewLifecycleCoordinator';
import {
  initializeWebviewDiscardTracking,
  inspectWebviewForDiscard,
  restoreWebviewSnapshot,
  type WebviewRestoreSnapshot,
} from './webviewDiscardProbe';

const NEAR_VIEWPORT_MARGIN_PX = 200;
const NEAR_VIEWPORT_MARGIN = `${NEAR_VIEWPORT_MARGIN_PX}px`;
const MEANINGFUL_VISIBLE_AREA = 12_000;
const MOTION_SETTLE_MS = 250;

interface UseManagedWebviewMountOptions {
  coordinator?: WebviewLifecycleCoordinator;
  enabled: boolean;
  nodeId: string;
  protectedState: boolean;
  url: string;
  webviewHostRef: RefObject<HTMLDivElement | null>;
}

interface ManagedWebviewMountResult {
  mountUrl: string;
  setCurrentWebview: (webview: EmbeddedWebviewTag | null) => void;
  shouldMount: boolean;
  state: WebviewLifecycleState;
  wake: () => void;
}

const isCanvasMotionActive = (host: HTMLElement): boolean => {
  const canvas = host.closest<HTMLElement>('.canvas-container');
  return canvas?.dataset.moving === 'on'
    || Boolean(host.closest('.canvas-transform--moving'));
};

const isInteractionSuppressed = (host: HTMLElement): boolean => {
  for (let element: HTMLElement | null = host; element; element = element.parentElement) {
    if (getComputedStyle(element).pointerEvents === 'none') return true;
    if (element.classList.contains('canvas-container')) break;
  }
  return false;
};

const getVisibility = (host: HTMLElement, rect: DOMRect | ClientRect) => {
  if (isInteractionSuppressed(host)) return { active: false, near: false };
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const canvasRect = host.closest<HTMLElement>('.canvas-container')?.getBoundingClientRect();
  const hasCanvasBounds = canvasRect && canvasRect.width > 0 && canvasRect.height > 0;
  const clipLeft = hasCanvasBounds ? Math.max(0, canvasRect.left) : 0;
  const clipTop = hasCanvasBounds ? Math.max(0, canvasRect.top) : 0;
  const clipRight = hasCanvasBounds ? Math.min(viewportWidth, canvasRect.right) : viewportWidth;
  const clipBottom = hasCanvasBounds ? Math.min(viewportHeight, canvasRect.bottom) : viewportHeight;
  const visibleWidth = Math.max(0, Math.min(rect.right, clipRight) - Math.max(rect.left, clipLeft));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, clipBottom) - Math.max(rect.top, clipTop));
  const visibleArea = visibleWidth * visibleHeight;
  const intersectsNearViewport = rect.right > clipLeft - NEAR_VIEWPORT_MARGIN_PX
    && rect.bottom > clipTop - NEAR_VIEWPORT_MARGIN_PX
    && rect.left < clipRight + NEAR_VIEWPORT_MARGIN_PX
    && rect.top < clipBottom + NEAR_VIEWPORT_MARGIN_PX;
  return {
    active: visibleArea >= MEANINGFUL_VISIBLE_AREA,
    near: intersectsNearViewport && rect.width * rect.height >= MEANINGFUL_VISIBLE_AREA,
  };
};

export const useManagedWebviewMount = ({
  coordinator = webviewLifecycleCoordinator,
  enabled,
  nodeId,
  protectedState,
  url,
  webviewHostRef,
}: UseManagedWebviewMountOptions): ManagedWebviewMountResult => {
  const reactId = useId();
  const instanceId = `${nodeId}:${reactId}`;
  const [shouldMount, setShouldMount] = useState(false);
  const [state, setState] = useState<WebviewLifecycleState>('deferred');
  const [mountUrl, setMountUrl] = useState(url);
  const aliveRef = useRef(true);
  const baseProtectionRef = useRef(protectedState);
  const currentWebviewRef = useRef<EmbeddedWebviewTag | null>(null);
  const detachWebviewRef = useRef<(() => void) | null>(null);
  const handleRef = useRef<WebviewLifecycleHandle | null>(null);
  const mediaProtectedRef = useRef(false);
  const restoreSnapshotRef = useRef<WebviewRestoreSnapshot | null>(null);
  const stateRef = useRef<WebviewLifecycleState>('deferred');

  const updateState = useCallback((next: WebviewLifecycleState) => {
    stateRef.current = next;
    if (aliveRef.current) setState(next);
  }, []);

  const syncProtection = useCallback(() => {
    handleRef.current?.setProtected(baseProtectionRef.current || mediaProtectedRef.current);
  }, []);

  const setCurrentWebview = useCallback((webview: EmbeddedWebviewTag | null) => {
    if (currentWebviewRef.current === webview) return;
    detachWebviewRef.current?.();
    detachWebviewRef.current = null;
    currentWebviewRef.current = webview;
    mediaProtectedRef.current = false;
    syncProtection();
    if (!webview) return;

    let attached = true;
    const touch = () => handleRef.current?.touch();
    const handleMediaStart = () => {
      mediaProtectedRef.current = true;
      touch();
      syncProtection();
    };
    const handleMediaStop = () => {
      mediaProtectedRef.current = false;
      syncProtection();
    };
    const handleReady = async () => {
      void initializeWebviewDiscardTracking(webview).catch(() => {
        // The discard probe remains fail-closed if tracking cannot install.
      });
      const snapshot = restoreSnapshotRef.current;
      if (stateRef.current === 'restoring' && snapshot) {
        try {
          await restoreWebviewSnapshot(webview, snapshot);
        } catch {
          // Reload recovery is still useful if scroll restoration is blocked.
        }
      }
      if (!attached || currentWebviewRef.current !== webview) return;
      restoreSnapshotRef.current = null;
      handleRef.current?.markReady();
      updateState('live');
    };

    webview.addEventListener('dom-ready', handleReady);
    webview.addEventListener('did-start-navigation', touch);
    webview.addEventListener('focus', touch);
    webview.addEventListener('media-started-playing', handleMediaStart);
    webview.addEventListener('media-paused', handleMediaStop);
    detachWebviewRef.current = () => {
      attached = false;
      webview.removeEventListener('dom-ready', handleReady);
      webview.removeEventListener('did-start-navigation', touch);
      webview.removeEventListener('focus', touch);
      webview.removeEventListener('media-started-playing', handleMediaStart);
      webview.removeEventListener('media-paused', handleMediaStop);
      if (currentWebviewRef.current === webview) currentWebviewRef.current = null;
      mediaProtectedRef.current = false;
    };
  }, [syncProtection, updateState]);

  useEffect(() => {
    restoreSnapshotRef.current = null;
    setMountUrl(url);
  }, [url]);

  useEffect(() => {
    aliveRef.current = true;
    if (!enabled) {
      setShouldMount(false);
      updateState('deferred');
      return undefined;
    }

    installWebviewLifecycleDebugApi();
    const handle = coordinator.register({
      id: instanceId,
      nodeId,
      canDiscard: async () => {
        const host = webviewHostRef.current;
        const webview = currentWebviewRef.current;
        if (
          !host
          || !webview
          || isCanvasMotionActive(host)
          || getVisibility(host, host.getBoundingClientRect()).active
        ) return false;
        const result = await inspectWebviewForDiscard(webview);
        if (
          !result.allowed
          || currentWebviewRef.current !== webview
          || webviewHostRef.current !== host
          || isCanvasMotionActive(host)
          || getVisibility(host, host.getBoundingClientRect()).active
        ) return false;
        restoreSnapshotRef.current = result.snapshot;
        return true;
      },
      onDiscard: () => {
        const snapshot = restoreSnapshotRef.current;
        if (snapshot?.url) setMountUrl(snapshot.url);
        setShouldMount(false);
        updateState('discarded');
      },
      onWake: (restoring) => {
        setShouldMount(true);
        updateState(restoring ? 'restoring' : 'live');
      },
    });
    handleRef.current = handle;
    syncProtection();

    return () => {
      if (handleRef.current === handle) handleRef.current = null;
      handle.unregister();
    };
  }, [coordinator, enabled, instanceId, nodeId, syncProtection, updateState, webviewHostRef]);

  useEffect(() => {
    baseProtectionRef.current = protectedState;
    syncProtection();
    const host = webviewHostRef.current;
    if (host && !isCanvasMotionActive(host)) {
      handleRef.current?.setVisibility(getVisibility(host, host.getBoundingClientRect()));
    }
  }, [protectedState, syncProtection, webviewHostRef]);

  useEffect(() => {
    if (!enabled) return undefined;
    const host = webviewHostRef.current;
    if (!host) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      handleRef.current?.setVisibility({ active: true, near: true });
      return undefined;
    }

    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSettledSync = () => {
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        syncRect(host.getBoundingClientRect());
      }, MOTION_SETTLE_MS);
    };
    const syncRect = (rect: DOMRect | ClientRect) => {
      if (isCanvasMotionActive(host)) {
        scheduleSettledSync();
        return;
      }
      handleRef.current?.setVisibility(getVisibility(host, rect));
    };
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === host) ?? entries[0];
      if (!entry) return;
      syncRect(entry.boundingClientRect);
    }, { rootMargin: NEAR_VIEWPORT_MARGIN });
    observer.observe(host);

    // IntersectionObserver only queues when an intersection threshold changes.
    // A zoom can move a fully intersecting node across our meaningful-area
    // threshold without changing its intersection ratio, so remeasure after
    // the canvas motion flags settle as well.
    const motionObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(scheduleSettledSync);
    const canvas = host.closest('.canvas-container');
    const transform = host.closest('.canvas-transform');
    if (motionObserver) {
      if (canvas) {
        motionObserver.observe(canvas, {
          attributes: true,
          attributeFilter: ['class', 'data-moving'],
        });
      }
      if (transform && transform !== canvas) {
        motionObserver.observe(transform, {
          attributes: true,
          attributeFilter: ['class', 'data-moving'],
        });
      }
    }
    return () => {
      observer.disconnect();
      motionObserver?.disconnect();
      if (settleTimer !== null) clearTimeout(settleTimer);
    };
  }, [enabled, webviewHostRef]);

  useEffect(() => () => {
    aliveRef.current = false;
    detachWebviewRef.current?.();
    detachWebviewRef.current = null;
  }, []);

  const wake = useCallback(() => handleRef.current?.wake(), []);

  return {
    mountUrl,
    setCurrentWebview,
    shouldMount,
    state,
    wake,
  };
};
