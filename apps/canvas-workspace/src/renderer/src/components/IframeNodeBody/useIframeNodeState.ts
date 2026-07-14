import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { IframeNodeData } from '../../types';
import { useEmbeddedBrowser } from '../EmbeddedBrowser/useEmbeddedBrowser';
import { useDeferredVisibleMount } from './useDeferredVisibleMount';
import { useWebviewDiscard } from './useWebviewDiscard';
import type { EditMode, IframeNodeBodyProps } from './types';
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
import { pickDomElementFromHtmlIframe, type DomPickerResult } from './domPickerBridge';

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
  const localUrl = data.localUrl ?? '';
  const savedPrompt = data.prompt ?? '';
  const artifactId = data.artifactId ?? null;
  const isArtifactMode = mode === 'artifact' && !!artifactId && !!workspaceId;
  const { artifact, artifactHtml } = useIframeArtifact({ artifactId, isArtifactMode, workspaceId });

  const hasContent = isArtifactMode ? !!artifactHtml : (mode === 'url' ? !!url : !!html || !!localUrl);
  const [editing, setEditing] = useState(!readOnly && !isArtifactMode && !hasContent);
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftHtml, setDraftHtml] = useState(html);
  const [draftPrompt, setDraftPrompt] = useState(savedPrompt);
  const [draftMode, setDraftMode] = useState<EditMode>(mode === 'ai' ? 'ai' : mode === 'html' ? 'html' : 'url');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [streamingActive, setStreamingActive] = useState(false);
  const [webviewKey, setWebviewKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const renderIframeRef = useRef<HTMLIFrameElement>(null);
  const streamIframeRef = useRef<HTMLIFrameElement>(null);
  const latestDataRef = useRef(data);
  const streamBuf = useRef('');
  const rafId = useRef(0);
  const shellReady = useRef(false);
  const pendingMorph = useRef<string | null>(null);

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  const webviewHostRef = useRef<HTMLDivElement>(null);
  const shouldMountWebview = useDeferredVisibleMount(webviewHostRef);

  // L3 discard (Memory Saver style): main tells us when this node's frozen
  // guest was reclaimed for memory; `!discarded` gates the webview mount
  // below, and dwell/click wakes it (useWebviewDiscard).
  const {
    discarded: webviewDiscarded,
    snapshot: discardSnapshot,
    wake: wakeWebview,
  } = useWebviewDiscard({
    workspaceId,
    nodeId: node.id,
    enabled: mode === 'url',
    hostRef: webviewHostRef,
  });

  // Same deferred-mount gate for inline (html/srcdoc/artifact) iframes: on an
  // iframe-heavy canvas, creating every off-screen subdocument at mount time
  // doubled the 86-node mount's long-task blocking (measured 140ms → 290ms;
  // docs/performance-verification-large-canvas.md). The observed element is
  // the pending shell (only rendered outside url/streaming modes), so the
  // rearm key re-arms the observer when those modes flip.
  const frameHostRef = useRef<HTMLDivElement>(null);
  const shouldMountInlineFrame = useDeferredVisibleMount(frameHostRef, '200px', `${mode}|${streamingActive}`);

  const handleBrowserTitleChange = useCallback((title: string) => {
    if (editing || readOnly) return;
    const rawTitle = sanitizePageTitle(title);
    const nextTitle = url === BLANK_PAGE_URL && rawTitle === BLANK_PAGE_URL ? 'Blank page' : rawTitle;
    if (!nextTitle || nextTitle === node.title) return;
    const latestData = latestDataRef.current;
    if (!shouldSyncIframeTitle(node.title, latestData, url)) return;

    const nextData = { ...latestData, pageTitle: nextTitle };
    latestDataRef.current = nextData;
    onUpdate(node.id, { title: nextTitle, data: nextData });
  }, [editing, node.id, node.title, onUpdate, readOnly, url]);

  const handleBrowserFaviconChange = useCallback((favicons: string[]) => {
    if (editing || readOnly) return;
    const faviconUrl = pickFaviconUrl(favicons);
    if (!faviconUrl) return;
    const latestData = latestDataRef.current;
    if (latestData.faviconUrl === faviconUrl) return;
    const nextData = { ...latestData, faviconUrl };
    latestDataRef.current = nextData;
    onUpdate(node.id, { data: nextData });
  }, [editing, node.id, onUpdate, readOnly]);

  const browser = useEmbeddedBrowser({
    className: 'iframe-frame',
    enabled: mode === 'url' && shouldMountWebview && !webviewDiscarded,
    hostRef: webviewHostRef,
    mountKey: webviewKey,
    onFaviconChange: handleBrowserFaviconChange,
    onTitleChange: handleBrowserTitleChange,
    url,
  });

  const loadState = editing || mode !== 'url' ? 'idle' : browser.loadState;
  const loadError = browser.loadError
    ? getFriendlyLoadErrorMessage(browser.loadError.description, browser.loadError.code)
    : null;

  useEffect(() => { setDraftUrl(url); }, [url]);
  useEffect(() => { setDraftHtml(html); }, [html]);
  useEffect(() => { setDraftPrompt(savedPrompt); }, [savedPrompt]);
  useEffect(() => { setDraftMode(mode === 'ai' ? 'ai' : mode === 'html' ? 'html' : 'url'); }, [mode]);

  useEffect(() => {
    if (readOnly || isArtifactMode) setEditing(false);
  }, [readOnly, isArtifactMode]);


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
    const el = browser.webview;
    if (!el) return;

    const api = window.canvasWorkspace.iframe;
    let registered = false;

    const tryRegister = (ready = false) => {
      if (registered && !ready) return;
      try {
        const id = el.getWebContentsId();
        if (typeof id === 'number') {
          registered = true;
          if (ready) void api.registerWebview(workspaceId, node.id, id, true);
          else void api.registerWebview(workspaceId, node.id, id);
        }
      } catch {
        // WebContents id is not available until Electron attaches the guest.
      }
    };

    tryRegister();
    const handleAttach = () => tryRegister(false);
    const handleReady = () => tryRegister(true);
    el.addEventListener('did-attach', handleAttach);
    el.addEventListener('dom-ready', handleReady);

    return () => {
      el.removeEventListener('did-attach', handleAttach);
      el.removeEventListener('dom-ready', handleReady);
      if (registered) void api.unregisterWebview(workspaceId, node.id);
    };
  }, [browser.webview, workspaceId, node.id, editing, url, mode]);

  // Drop the webview's paint frame rate when the node is parked outside the
  // canvas viewport long enough. Disabled during editing (no live webview to
  // throttle) and when the node is in non-url modes (html/ai/artifact don't
  // use a <webview>). readOnly iframes still register a webview and should
  // still benefit. See useWebviewBackgroundThrottle for the rationale.
  useWebviewBackgroundThrottle({
    hostRef: browser.hostRef,
    workspaceId,
    nodeId: node.id,
    disabled: editing || mode !== 'url' || webviewDiscarded,
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

  const pickDomElement = useCallback((): Promise<DomPickerResult> => {
    if (!workspaceId) {
      return Promise.resolve({ ok: false, error: 'This workspace is not ready yet.' });
    }
    if (mode === 'url') {
      return window.canvasWorkspace.iframe.pickDomElement(workspaceId, node.id);
    }
    return pickDomElementFromHtmlIframe(renderIframeRef.current, workspaceId, node.id);
  }, [mode, node.id, workspaceId]);

  // While discarded (L3 sleeping) there is no <webview> behind the toolbar —
  // reload/back/forward would silently no-op on browser.webview === null.
  // Waking IS the recovery action: the remount recreates the guest and
  // loads the page (session history does not survive a discard anyway).
  const handleReload = useCallback(() => {
    if (mode !== 'url') {
      setWebviewKey((key) => key + 1);
      return;
    }
    if (webviewDiscarded) {
      wakeWebview();
      return;
    }
    browser.reload();
  }, [browser, mode, webviewDiscarded, wakeWebview]);

  const handleGoBack = useCallback(() => {
    if (webviewDiscarded) {
      wakeWebview();
      return;
    }
    browser.goBack();
  }, [browser, webviewDiscarded, wakeWebview]);

  const handleGoForward = useCallback(() => {
    if (webviewDiscarded) {
      wakeWebview();
      return;
    }
    browser.goForward();
  }, [browser, webviewDiscarded, wakeWebview]);

  return {
    artifact,
    artifactHtml,
    artifactId,
    canGoBack: browser.canGoBack,
    canGoForward: browser.canGoForward,
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
    handleGoBack,
    handleGoForward,
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
    localUrl,
    mode,
    openBlankPage,
    pickDomElement,
    promptRef,
    renderIframeRef,
    savedPrompt,
    setDraftHtml,
    setDraftMode,
    setDraftPrompt,
    setDraftUrl,
    setEditing,
    discardSnapshot,
    frameHostRef,
    shouldMountInlineFrame,
    wakeWebview,
    webviewDiscarded,
    streamIframeRef,
    streamingActive,
    textareaRef,
    url,
    webviewHostRef,
    webviewKey,
  };
};
