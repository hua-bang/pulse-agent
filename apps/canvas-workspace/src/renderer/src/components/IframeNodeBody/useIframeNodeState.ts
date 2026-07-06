import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { IframeNodeData } from '../../types';
import { useDeferredVisibleMount } from './useDeferredVisibleMount';
import type { EditMode, IframeNodeBodyProps, LoadState, WebviewTag } from './types';
import {
  BLANK_PAGE_URL,
  getFriendlyLoadErrorMessage,
  normalizeUrl,
  pickFaviconUrl,
  prettyTitle,
  sanitizePageTitle,
  shouldSyncIframeTitle,
} from './utils';
import { isImeComposing } from '../../utils/ime';
import { useWebviewBackgroundThrottle } from './useWebviewBackgroundThrottle';
import { useIframeArtifact } from './useIframeArtifact';

export const useIframeNodeState = ({
  node,
  workspaceId,
  onUpdate,
  readOnly = false,
}: IframeNodeBodyProps) => {
  const data = node.data as IframeNodeData;
  const mode = data.mode ?? 'url';
  const url = data.url ?? '';
  const html = data.html ?? '';
  const savedPrompt = data.prompt ?? '';
  const artifactId = data.artifactId ?? null;
  const isArtifactMode = mode === 'artifact' && !!artifactId && !!workspaceId;
  const { artifact, artifactHtml } = useIframeArtifact({ artifactId, isArtifactMode, workspaceId });

  const hasContent = isArtifactMode ? !!artifactHtml : (mode === 'url' ? !!url : !!html);
  const [editing, setEditing] = useState(!readOnly && !isArtifactMode && !hasContent);
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftHtml, setDraftHtml] = useState(html);
  const [draftPrompt, setDraftPrompt] = useState(savedPrompt);
  const [draftMode, setDraftMode] = useState<EditMode>(mode === 'ai' ? 'ai' : mode === 'html' ? 'html' : 'url');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [streamingActive, setStreamingActive] = useState(false);
  const [webviewKey, setWebviewKey] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const webviewRef = useRef<WebviewTag | null>(null);
  const webviewHostRef = useRef<HTMLDivElement>(null);
  const streamIframeRef = useRef<HTMLIFrameElement>(null);
  const latestDataRef = useRef(data);
  const streamBuf = useRef('');
  const rafId = useRef(0);
  const shellReady = useRef(false);
  const pendingMorph = useRef<string | null>(null);

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  const shouldMountWebview = useDeferredVisibleMount(webviewHostRef);
  useLayoutEffect(() => {
    if (mode !== 'url' || !shouldMountWebview) return;
    const host = webviewHostRef.current;
    if (!host) return;

    const webview = document.createElement('webview') as WebviewTag;
    webview.setAttribute('allowpopups', '');
    if (url) webview.setAttribute('src', url);
    webview.className = 'iframe-frame';
    host.appendChild(webview);
    webviewRef.current = webview;

    return () => {
      webview.remove();
      if (webviewRef.current === webview) webviewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, webviewKey, shouldMountWebview]);

  useEffect(() => {
    const el = webviewRef.current;
    if (!el || mode !== 'url') return;
    if (el.getAttribute('src') !== url) el.setAttribute('src', url);
  }, [url, mode]);

  useEffect(() => { setDraftUrl(url); }, [url]);
  useEffect(() => { setDraftHtml(html); }, [html]);
  useEffect(() => { setDraftPrompt(savedPrompt); }, [savedPrompt]);
  useEffect(() => { setDraftMode(mode === 'ai' ? 'ai' : mode === 'html' ? 'html' : 'url'); }, [mode]);

  useEffect(() => {
    if (readOnly || isArtifactMode) setEditing(false);
  }, [readOnly, isArtifactMode]);

  useEffect(() => {
    if (mode !== 'url' || editing) {
      setLoadState('idle');
      setLoadError(null);
      return;
    }
    setLoadState(url ? 'loading' : 'idle');
    setLoadError(null);
  }, [editing, mode, url, webviewKey]);

  useEffect(() => {
    if (mode !== 'url' || editing || readOnly) return;
    const el = webviewRef.current;
    if (!el) return;

    const handlePageTitleUpdated = (event: Event) => {
      const rawTitle = sanitizePageTitle((event as Event & { title?: string }).title);
      const nextTitle = url === BLANK_PAGE_URL && rawTitle === BLANK_PAGE_URL ? 'Blank page' : rawTitle;
      if (!nextTitle || nextTitle === node.title) return;
      const latestData = latestDataRef.current;
      if (!shouldSyncIframeTitle(node.title, latestData, url)) return;

      const nextData = { ...latestData, pageTitle: nextTitle };
      latestDataRef.current = nextData;
      onUpdate(node.id, {
        title: nextTitle,
        data: nextData,
      });
    };
    const handlePageFaviconUpdated = (event: Event) => {
      const faviconUrl = pickFaviconUrl((event as Event & { favicons?: string[] }).favicons);
      if (!faviconUrl) return;
      const latestData = latestDataRef.current;
      if (latestData.faviconUrl === faviconUrl) return;
      const nextData = { ...latestData, faviconUrl };
      latestDataRef.current = nextData;
      onUpdate(node.id, { data: nextData });
    };
    const handleDidStartLoading = () => {
      setLoadState('loading');
      setLoadError(null);
    };
    const handleDidStopLoading = () => setLoadState((current) => current === 'failed' ? current : 'ready');
    const handleDidFailLoad = (event: Event) => {
      const detail = event as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      if (detail.isMainFrame === false) return;
      if (detail.errorCode === -3) return;
      setLoadState('failed');
      setLoadError(getFriendlyLoadErrorMessage(detail.errorDescription, detail.errorCode));
    };

    el.addEventListener('page-title-updated', handlePageTitleUpdated);
    el.addEventListener('page-favicon-updated', handlePageFaviconUpdated);
    el.addEventListener('did-start-loading', handleDidStartLoading);
    el.addEventListener('did-stop-loading', handleDidStopLoading);
    el.addEventListener('did-fail-load', handleDidFailLoad);
    return () => {
      el.removeEventListener('page-title-updated', handlePageTitleUpdated);
      el.removeEventListener('page-favicon-updated', handlePageFaviconUpdated);
      el.removeEventListener('did-start-loading', handleDidStartLoading);
      el.removeEventListener('did-stop-loading', handleDidStopLoading);
      el.removeEventListener('did-fail-load', handleDidFailLoad);
    };
  }, [data, editing, mode, node.id, node.title, onUpdate, readOnly, url, webviewKey]);

  useEffect(() => {
    if (!editing) return undefined;
    const timer = setTimeout(() => {
      if (draftMode === 'url') inputRef.current?.select();
      else if (draftMode === 'html') textareaRef.current?.focus();
      else promptRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [editing, draftMode]);

  useEffect(() => {
    if (!streamingActive) {
      shellReady.current = false;
      return;
    }

    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'morph-ready') {
        shellReady.current = true;
        if (pendingMorph.current && streamIframeRef.current?.contentWindow) {
          streamIframeRef.current.contentWindow.postMessage(
            { type: 'morph', html: pendingMorph.current },
            '*',
          );
          pendingMorph.current = null;
        }
      }
    };

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      shellReady.current = false;
    };
  }, [streamingActive]);

  useEffect(() => {
    if (editing || mode !== 'url') return;
    if (!workspaceId) return;
    const el = webviewRef.current;
    if (!el) return;

    const api = window.canvasWorkspace.iframe;
    let registered = false;

    const tryRegister = () => {
      if (registered) return;
      try {
        const id = el.getWebContentsId();
        if (typeof id === 'number') {
          registered = true;
          void api.registerWebview(workspaceId, node.id, id);
        }
      } catch {
        // WebContents id is not available until Electron attaches the guest.
      }
    };

    tryRegister();
    el.addEventListener('did-attach', tryRegister);
    el.addEventListener('dom-ready', tryRegister);

    return () => {
      el.removeEventListener('did-attach', tryRegister);
      el.removeEventListener('dom-ready', tryRegister);
      if (registered) void api.unregisterWebview(workspaceId, node.id);
    };
  }, [workspaceId, node.id, editing, url, mode, webviewKey]);

  // Drop the webview's paint frame rate when the node is parked outside the
  // canvas viewport long enough. Disabled during editing (no live webview to
  // throttle) and when the node is in non-url modes (html/ai/artifact don't
  // use a <webview>). readOnly iframes still register a webview and should
  // still benefit. See useWebviewBackgroundThrottle for the rationale.
  useWebviewBackgroundThrottle({
    hostRef: webviewHostRef,
    workspaceId,
    nodeId: node.id,
    disabled: editing || mode !== 'url',
  });

  const flushToIframe = useCallback(() => {
    const currentHtml = streamBuf.current;
    const win = streamIframeRef.current?.contentWindow;

    if (win && shellReady.current) {
      win.postMessage({ type: 'morph', html: currentHtml }, '*');
    } else {
      pendingMorph.current = currentHtml;
    }
  }, []);

  const commit = useCallback(() => {
    if (readOnly) return;
    if (draftMode === 'url') {
      const next = normalizeUrl(draftUrl.trim());
      const shouldUseAutoTitle = shouldSyncIframeTitle(node.title, data, url);
      onUpdate(node.id, {
        data: { ...data, url: next, mode: 'url', pageTitle: '' },
        title: shouldUseAutoTitle && next ? prettyTitle(next) : node.title,
      });
    } else if (draftMode === 'html') {
      onUpdate(node.id, {
        data: { ...data, html: draftHtml, mode: 'html' },
        title: node.title === 'Web' ? 'HTML' : node.title,
      });
    }
    setEditing(false);
  }, [draftMode, draftUrl, draftHtml, onUpdate, node.id, node.title, data, readOnly, url]);

  const openBlankPage = useCallback(() => {
    if (readOnly) return;
    const shouldUseAutoTitle = shouldSyncIframeTitle(node.title, data, url);
    onUpdate(node.id, {
      data: { ...data, url: BLANK_PAGE_URL, mode: 'url', pageTitle: '' },
      title: shouldUseAutoTitle ? 'Blank page' : node.title,
    });
    setDraftUrl(BLANK_PAGE_URL);
    setDraftMode('url');
    setEditing(false);
  }, [data, node.id, node.title, onUpdate, readOnly, url]);

  const startStream = useCallback(async (
    prompt: string,
    opts: { fromEditor?: boolean } = {},
  ) => {
    if (readOnly) return;
    setGenerating(true);
    setGenError(null);
    setStreamingActive(true);
    streamBuf.current = '';
    shellReady.current = false;
    pendingMorph.current = null;

    if (opts.fromEditor) setEditing(false);

    try {
      const llm = window.canvasWorkspace.llm;
      const startResult = await llm.streamHTML(prompt);

      if (!startResult.ok || !startResult.requestId) {
        setGenError(startResult.error ?? 'Failed to start generation');
        setGenerating(false);
        setStreamingActive(false);
        if (opts.fromEditor) setEditing(true);
        return;
      }

      const requestId = startResult.requestId;
      const unsub = llm.onHTMLDelta(requestId, (delta) => {
        streamBuf.current += delta;
        if (!rafId.current) {
          rafId.current = requestAnimationFrame(() => {
            rafId.current = 0;
            flushToIframe();
          });
        }
      });

      const unsubComplete = llm.onHTMLComplete(requestId, (result) => {
        unsub();
        unsubComplete();
        if (rafId.current) {
          cancelAnimationFrame(rafId.current);
          rafId.current = 0;
        }

        if (result.ok && result.html) {
          onUpdate(node.id, {
            data: { ...data, html: result.html, prompt, mode: 'ai' },
            title: node.title === 'Web' ? 'AI Visual' : node.title,
          });
        } else {
          setGenError(result.error ?? 'Generation failed');
          if (opts.fromEditor) setEditing(true);
        }
        setStreamingActive(false);
        setGenerating(false);
      });
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
      setStreamingActive(false);
      setGenerating(false);
      if (opts.fromEditor) setEditing(true);
    }
  }, [flushToIframe, onUpdate, node.id, node.title, data, readOnly]);

  const handleGenerate = useCallback(
    () => startStream(draftPrompt.trim(), { fromEditor: true }),
    [startStream, draftPrompt],
  );

  const handleRegenerate = useCallback(
    () => startStream(savedPrompt.trim()),
    [startStream, savedPrompt],
  );

  const cancel = useCallback(() => {
    setDraftUrl(url);
    setDraftHtml(html);
    setDraftPrompt(savedPrompt);
    setDraftMode(mode === 'ai' ? 'ai' : mode === 'html' ? 'html' : 'url');
    setGenError(null);
    if (!readOnly) setEditing(false);
  }, [url, html, savedPrompt, mode, readOnly]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (isImeComposing(e)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
    [commit, cancel],
  );

  const handleTextareaKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
    [commit, cancel],
  );

  const handlePromptKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleGenerate();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
    [handleGenerate, cancel],
  );

  const handleOpenExternal = useCallback(() => {
    if (mode === 'url' && url) void window.canvasWorkspace.shell.openExternal(url);
  }, [mode, url]);

  const handleReload = useCallback(() => {
    setLoadState(mode === 'url' && url ? 'loading' : 'idle');
    setLoadError(null);
    if (mode !== 'url') {
      setWebviewKey((key) => key + 1);
      return;
    }
    const el = webviewRef.current;
    if (el && typeof el.reload === 'function') {
      try {
        el.reload();
        return;
      } catch {
        // Fall back to a webview remount.
      }
    }
    setWebviewKey((key) => key + 1);
  }, [mode, url]);

  return {
    artifact,
    artifactHtml,
    artifactId,
    cancel,
    commit,
    data,
    draftHtml,
    draftMode,
    draftPrompt,
    draftUrl,
    editing,
    genError,
    generating,
    handleGenerate,
    handleKeyDown,
    handleOpenExternal,
    handlePromptKeyDown,
    handleRegenerate,
    handleReload,
    handleTextareaKeyDown,
    hasContent,
    html,
    inputRef,
    isArtifactMode,
    loadError,
    loadState,
    mode,
    openBlankPage,
    promptRef,
    savedPrompt,
    setDraftHtml,
    setDraftMode,
    setDraftPrompt,
    setDraftUrl,
    setEditing,
    streamIframeRef,
    streamingActive,
    textareaRef,
    url,
    webviewHostRef,
    webviewKey,
  };
};
