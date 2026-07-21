import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './PdfNodeView.css';
import { PDF_PICK_FILE_CHANNEL } from './constants';
import { normalizePdfPayload, pdfFileUrl } from './pdf';
import { isRecord } from './scene';
import type {
  PdfDocumentState,
  PdfSource,
  PluginNodeData,
  PluginNodeViewProps,
} from './types';

const MIN_PDF_HEIGHT = 420;

interface WebviewTag extends HTMLElement {
  reload(): void;
}

interface PickFileResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  source?: PdfSource;
  pageCount?: number | null;
}

function getPluginData(nodeData: unknown): PluginNodeData {
  return isRecord(nodeData) ? nodeData as PluginNodeData : {};
}

function syncWebviewSize(host: HTMLElement, webview: HTMLElement): void {
  const width = Math.max(1, Math.floor(host.clientWidth || host.offsetWidth || 1));
  const height = Math.max(1, Math.floor(host.clientHeight || host.offsetHeight || 1));
  webview.style.width = `${width}px`;
  webview.style.height = `${height}px`;
}

function syncWebviewShadowFrameHeight(webview: HTMLElement): boolean {
  const frame = webview.shadowRoot?.querySelector('iframe');
  if (!(frame instanceof HTMLIFrameElement)) return false;
  frame.style.height = '100%';
  return true;
}

export function PdfNodeView({
  node,
  readOnly,
  selected,
  updateNode,
  invoke,
}: PluginNodeViewProps) {
  const nodeData = getPluginData(node.data);
  const state = useMemo(() => normalizePdfPayload(nodeData.payload), [nodeData.payload]);
  const nodeDataRef = useRef(nodeData);
  const webviewHostRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<WebviewTag | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    nodeDataRef.current = nodeData;
  }, [nodeData]);

  useEffect(() => {
    if (readOnly || node.height >= MIN_PDF_HEIGHT) return;
    updateNode({ height: MIN_PDF_HEIGHT });
  }, [node.height, readOnly, updateNode]);

  const sourcePath = state.source?.path ?? null;
  const viewerUrl = useMemo(
    () => (sourcePath ? pdfFileUrl(sourcePath, state.currentPage) : null),
    [sourcePath, state.currentPage],
  );

  useLayoutEffect(() => {
    const host = webviewHostRef.current;
    if (!host || !viewerUrl) return;

    const webview = document.createElement('webview') as WebviewTag;
    // Chromium's built-in PDF viewer runs as a plugin inside the guest.
    webview.setAttribute('plugins', '');
    webview.setAttribute('src', viewerUrl);
    webview.className = 'pdf-node__webview';
    webview.style.position = 'absolute';
    webview.style.inset = '0';
    webview.style.display = 'block';
    host.appendChild(webview);
    webviewRef.current = webview;
    setLoadError(null);

    let shadowFrameSyncFrame = 0;
    const scheduleShadowFrameHeightSync = (attempt = 0) => {
      if (shadowFrameSyncFrame) cancelAnimationFrame(shadowFrameSyncFrame);
      shadowFrameSyncFrame = requestAnimationFrame(() => {
        shadowFrameSyncFrame = 0;
        const synced = syncWebviewShadowFrameHeight(webview);
        if (!synced && attempt < 12) scheduleShadowFrameHeightSync(attempt + 1);
      });
    };

    const handleFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      if (detail.isMainFrame === false || detail.errorCode === -3) return;
      setLoadError(detail.errorDescription ?? 'The PDF failed to load.');
    };
    const handleDomReady = () => {
      setLoadError(null);
      scheduleShadowFrameHeightSync();
    };

    webview.addEventListener('did-fail-load', handleFail);
    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-attach', () => scheduleShadowFrameHeightSync());
    scheduleShadowFrameHeightSync();

    let resizeFrame = 0;
    const syncSize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        syncWebviewSize(host, webview);
        if (!syncWebviewShadowFrameHeight(webview)) scheduleShadowFrameHeightSync();
      });
    };
    const resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(host);
    syncSize();

    return () => {
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(shadowFrameSyncFrame);
      resizeObserver.disconnect();
      webview.removeEventListener('did-fail-load', handleFail);
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.remove();
      if (webviewRef.current === webview) webviewRef.current = null;
    };
    // Recreating the webview on URL change also applies agent-driven
    // go_to_page navigation: the Chromium viewer only reads #page= at load.
  }, [viewerUrl]);

  const pickFile = useCallback(async () => {
    if (picking) return;
    setPicking(true);
    setPickError(null);
    try {
      const result = await invoke<PickFileResult>(PDF_PICK_FILE_CHANNEL);
      if (!result?.ok || !result.source) {
        if (result?.error) setPickError(result.error);
        return;
      }
      const nextState: PdfDocumentState = {
        title: result.source.name,
        source: result.source,
        pageCount: result.pageCount ?? null,
        currentPage: 1,
        updatedAt: new Date().toISOString(),
      };
      updateNode({
        title: result.source.name,
        data: {
          ...nodeDataRef.current,
          payload: nextState,
        },
      });
    } catch (err) {
      setPickError(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(false);
    }
  }, [invoke, picking, updateNode]);

  const hasSource = !!state.source;

  return (
    <div
      className={`pdf-node${selected ? ' pdf-node--selected' : ''}`}
      onPointerDownCapture={(event: React.PointerEvent<HTMLDivElement>) => event.stopPropagation()}
      onWheelCapture={(event: React.WheelEvent<HTMLDivElement>) => event.stopPropagation()}
    >
      {hasSource && (
        <div className="pdf-node__toolbar">
          <span className="pdf-node__filename" title={state.source?.path}>
            {state.source?.name}
          </span>
          {state.pageCount != null && (
            <span className="pdf-node__pages">{state.pageCount} pages</span>
          )}
          {!readOnly && (
            <button
              type="button"
              className="pdf-node__button"
              disabled={picking}
              onClick={() => { void pickFile(); }}
            >
              Replace
            </button>
          )}
        </div>
      )}
      <div className="pdf-node__surface" ref={webviewHostRef}>
        {!hasSource && (
          <div className="pdf-node__empty">
            <div className="pdf-node__empty-title">No PDF attached</div>
            <div className="pdf-node__empty-message">
              Choose a PDF file, or ask the Agent to attach one with this node selected.
            </div>
            {!readOnly && (
              <button
                type="button"
                className="pdf-node__button pdf-node__button--primary"
                disabled={picking}
                onClick={() => { void pickFile(); }}
              >
                {picking ? 'Choosing…' : 'Choose PDF file'}
              </button>
            )}
            {pickError && <div className="pdf-node__error">{pickError}</div>}
          </div>
        )}
        {hasSource && loadError && (
          <div className="pdf-node__load-error">
            <div className="pdf-node__empty-title">PDF failed to load</div>
            <div className="pdf-node__empty-message">{loadError}</div>
            <button
              type="button"
              className="pdf-node__button"
              onClick={() => {
                setLoadError(null);
                webviewRef.current?.reload();
              }}
            >
              Reload
            </button>
          </div>
        )}
      </div>
      <div className="pdf-node__badge">pdf.document</div>
    </div>
  );
}
