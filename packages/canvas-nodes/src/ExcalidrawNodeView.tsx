import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './ExcalidrawNodeView.css';
import { normalizeBoardPayload, isRecord } from './scene';
import type {
  ExcalidrawBoardScene,
  PluginNodeData,
  PluginNodeViewProps,
} from './types';

function resolveWebviewAppUrl(): string {
  const moduleUrl = import.meta.url;
  const baseUrl = moduleUrl.slice(0, moduleUrl.lastIndexOf('/') + 1);
  return new URL(['..', 'index.html'].join('/'), baseUrl).href;
}

type LoadState = 'loading' | 'ready' | 'failed';
const MIN_BOARD_HEIGHT = 560;

interface WebviewTag extends HTMLElement {
  getWebContentsId(): number;
  executeJavaScript<T = unknown>(script: string, userGesture?: boolean): Promise<T>;
  reload(): void;
}

interface PulseCanvasIframeApi {
  registerWebview(
    workspaceId: string,
    nodeId: string,
    webContentsId: number,
  ): Promise<{ ok: boolean }>;
  unregisterWebview(workspaceId: string, nodeId: string): Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    canvasWorkspace?: {
      iframe?: PulseCanvasIframeApi;
    };
  }
}

function getPluginData(nodeData: unknown): PluginNodeData {
  return isRecord(nodeData) ? nodeData as PluginNodeData : {};
}

function sceneKey(scene: ExcalidrawBoardScene): string {
  try {
    return JSON.stringify({
      elements: scene.elements,
      appState: scene.appState,
      files: scene.files,
    });
  } catch {
    return `${scene.elements.length}:${scene.updatedAt ?? ''}`;
  }
}

function sanitizeSceneSnapshot(value: unknown, fallbackTitle: string): ExcalidrawBoardScene {
  const raw = isRecord(value) ? value : {};
  return normalizeBoardPayload({
    ...raw,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : fallbackTitle,
  });
}

function scriptArg(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function measureHostLayoutSize(host: HTMLElement): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(host.clientWidth || host.offsetWidth || 1)),
    height: Math.max(MIN_BOARD_HEIGHT, Math.floor(host.clientHeight || host.offsetHeight || 1)),
  };
}

function syncWebviewSize(host: HTMLElement, webview: WebviewTag): void {
  const { width, height } = measureHostLayoutSize(host);
  webview.style.width = `${width}px`;
  webview.style.height = `${height}px`;
}

function syncWebviewShadowFrameHeight(webview: WebviewTag): boolean {
  const frame = webview.shadowRoot?.querySelector('iframe');
  if (!(frame instanceof HTMLIFrameElement)) return false;
  frame.style.height = '100%';
  return true;
}

function notifyGuestResize(webview: WebviewTag, host: HTMLElement): void {
  const { width, height } = measureHostLayoutSize(host);
  try {
    void webview.executeJavaScript(
      `(() => {
        window.__pulseCanvasExcalidraw?.resize?.(${scriptArg({ width, height })});
        window.dispatchEvent(new Event('resize'));
        return true;
      })()`,
      false,
    ).catch(() => undefined);
  } catch {
    // Electron throws synchronously if the guest has not reached dom-ready yet.
  }
}

export function ExcalidrawNodeView({
  node,
  readOnly,
  selected,
  workspaceId,
  updateNode,
}: PluginNodeViewProps) {
  const nodeData = getPluginData(node.data);
  const scene = useMemo(() => normalizeBoardPayload(nodeData.payload), [nodeData.payload]);
  const key = useMemo(() => sceneKey(scene), [scene]);
  const webviewHostRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<WebviewTag | null>(null);
  const nodeDataRef = useRef(nodeData);
  const lastPersistedKeyRef = useRef(key);
  const hydratedKeyRef = useRef('');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    nodeDataRef.current = nodeData;
  }, [nodeData]);

  useEffect(() => {
    lastPersistedKeyRef.current = key;
  }, [key]);

  useEffect(() => {
    if (readOnly || node.height >= MIN_BOARD_HEIGHT) return;
    updateNode({ height: MIN_BOARD_HEIGHT });
  }, [node.height, readOnly, updateNode]);

  useLayoutEffect(() => {
    const host = webviewHostRef.current;
    if (!host) return;

    const webview = document.createElement('webview') as WebviewTag;
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('src', resolveWebviewAppUrl());
    webview.className = 'excalidraw-node__webview';
    webview.style.position = 'absolute';
    webview.style.inset = '0';
    webview.style.display = 'block';
    webview.style.minWidth = '100%';
    webview.style.minHeight = '100%';
    host.appendChild(webview);
    webviewRef.current = webview;
    setLoadState('loading');
    setLoadError(null);

    let webviewDomReady = false;
    let shadowFrameSyncFrame = 0;
    const scheduleShadowFrameHeightSync = (attempt = 0) => {
      if (shadowFrameSyncFrame) cancelAnimationFrame(shadowFrameSyncFrame);
      shadowFrameSyncFrame = requestAnimationFrame(() => {
        shadowFrameSyncFrame = 0;
        const synced = syncWebviewShadowFrameHeight(webview);
        if (!synced && attempt < 12) scheduleShadowFrameHeightSync(attempt + 1);
      });
    };
    const handleDomReady = () => {
      webviewDomReady = true;
      setLoadState('ready');
      setLoadError(null);
      scheduleShadowFrameHeightSync();
      notifyGuestResize(webview, host);
    };
    const handleDidStartLoading = () => {
      webviewDomReady = false;
      setLoadState('loading');
      setLoadError(null);
    };
    const handleFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      if (detail.isMainFrame === false || detail.errorCode === -3) return;
      setLoadState('failed');
      setLoadError(detail.errorDescription ?? 'The Excalidraw webview failed to load.');
    };

    const api = window.canvasWorkspace?.iframe;
    let registered = false;
    const tryRegister = () => {
      if (registered || !api || !workspaceId) return;
      try {
        const webContentsId = webview.getWebContentsId();
        if (typeof webContentsId === 'number') {
          registered = true;
          void api.registerWebview(workspaceId, node.id, webContentsId);
        }
      } catch {
        // Electron exposes the WebContents id only after the guest attaches.
      }
    };
    const handleDidAttach = () => {
      tryRegister();
      scheduleShadowFrameHeightSync();
    };

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-start-loading', handleDidStartLoading);
    webview.addEventListener('did-fail-load', handleFail);
    webview.addEventListener('did-attach', handleDidAttach);
    webview.addEventListener('dom-ready', tryRegister);
    tryRegister();
    scheduleShadowFrameHeightSync();

    let resizeFrame = 0;
    const syncSize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        syncWebviewSize(host, webview);
        if (!syncWebviewShadowFrameHeight(webview)) scheduleShadowFrameHeightSync();
        if (webviewDomReady) notifyGuestResize(webview, host);
      });
    };
    const resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(host);
    syncSize();

    return () => {
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(shadowFrameSyncFrame);
      resizeObserver.disconnect();
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-start-loading', handleDidStartLoading);
      webview.removeEventListener('did-fail-load', handleFail);
      webview.removeEventListener('did-attach', handleDidAttach);
      webview.removeEventListener('dom-ready', tryRegister);
      webview.remove();
      if (webviewRef.current === webview) webviewRef.current = null;
      if (registered && api && workspaceId) {
        void api.unregisterWebview(workspaceId, node.id);
      }
    };
  }, [node.id, workspaceId]);

  const pushSceneToWebview = useCallback(async (attempt = 0) => {
    const webview = webviewRef.current;
    if (!webview || loadState !== 'ready') return;

    const payload = {
      scene,
      readOnly: !!readOnly,
    };

    try {
      const ok = await webview.executeJavaScript<boolean>(
        `(() => {
          const bridge = window.__pulseCanvasExcalidraw;
          if (!bridge) return false;
          bridge.setScene(${scriptArg(payload)});
          return true;
        })()`,
        false,
      );
      if (ok) {
        lastPersistedKeyRef.current = key;
        hydratedKeyRef.current = key;
        return;
      }
    } catch {
      // The guest can briefly reject scripts while it is navigating.
    }

    if (attempt < 8) {
      window.setTimeout(() => {
        void pushSceneToWebview(attempt + 1);
      }, 125);
    }
  }, [key, loadState, readOnly, scene]);

  useEffect(() => {
    void pushSceneToWebview();
  }, [pushSceneToWebview]);

  useEffect(() => {
    if (readOnly || loadState !== 'ready') return;

    const poll = async () => {
      if (hydratedKeyRef.current !== key) return;
      const webview = webviewRef.current;
      if (!webview) return;
      try {
        const raw = await webview.executeJavaScript<unknown>(
          `window.__pulseCanvasExcalidraw?.getScene?.() ?? null`,
          false,
        );
        const nextScene = sanitizeSceneSnapshot(raw, scene.title);
        const nextKey = sceneKey(nextScene);
        if (nextKey === lastPersistedKeyRef.current || nextKey === key) return;
        lastPersistedKeyRef.current = nextKey;
        updateNode({
          data: {
            ...nodeDataRef.current,
            payload: nextScene,
          },
        });
      } catch {
        // Polling is best effort; the next tick will retry once the guest settles.
      }
    };

    const timer = window.setInterval(() => {
      void poll();
    }, 700);
    return () => window.clearInterval(timer);
  }, [key, loadState, readOnly, scene.title, updateNode]);

  const empty = scene.elements.length === 0;
  const failed = loadState === 'failed';

  return (
    <div
      className={`excalidraw-node${selected ? ' excalidraw-node--selected' : ''}`}
      onPointerDownCapture={(event: React.PointerEvent<HTMLDivElement>) => event.stopPropagation()}
      onWheelCapture={(event: React.WheelEvent<HTMLDivElement>) => event.stopPropagation()}
    >
      <div className="excalidraw-node__surface" ref={webviewHostRef} />
      {failed && (
        <div className="excalidraw-node__load-error">
          <div className="excalidraw-node__load-title">Excalidraw failed to load</div>
          <div className="excalidraw-node__load-message">
            {loadError ?? 'The embedded board could not be displayed.'}
          </div>
          <button
            type="button"
            className="excalidraw-node__reload"
            onClick={() => {
              setLoadState('loading');
              webviewRef.current?.reload();
            }}
          >
            Reload
          </button>
        </div>
      )}
      <div className="excalidraw-node__badge">excalidraw.board</div>
      {empty && (
        <div className="excalidraw-node__empty">
          Draw here, or ask the Agent to create an Excalidraw diagram with this node selected.
        </div>
      )}
    </div>
  );
}
