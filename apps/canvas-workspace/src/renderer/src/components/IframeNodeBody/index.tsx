import { useCallback, useEffect, useRef, useState } from "react";
import "./index.css";
import type { Artifact, CanvasNode, IframeNodeData } from "../../types";
import { useArtifactDrawer } from "../artifacts";
import { STREAMING_SHELL } from "../artifacts/streamingShell";

type EditMode = "url" | "html" | "ai";

const BLANK_PAGE_URL = "about:blank";

/**
 * Capture-phase link interceptor injected into the guest page.
 *
 * Feishu / Lark / Notion-style SPAs attach click handlers in the bubble
 * phase that call `e.preventDefault()` and route via an internal client
 * router instead of letting the browser open a new tab. That cancels the
 * default `window.open` behavior before our `setWindowOpenHandler` can
 * see it — to the user the link just looks dead.
 *
 * Running on the document in the capture phase lets us beat the page's
 * own bubble handler: if the click was on a real `<a href>` going to an
 * http(s) page that isn't just an in-page anchor, we call
 * `window.open(href, '_blank')` ourselves, which goes through the host's
 * popup handler (→ system browser). Same-page fragments, modifier-click
 * gestures and `javascript:` links pass through untouched.
 */
const LINK_INTERCEPTOR_SCRIPT = `
  (function() {
    if (window.__pulseCanvasLinkHookInstalled) return;
    window.__pulseCanvasLinkHookInstalled = true;
    document.addEventListener('click', function(e) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var node = e.target;
      var anchor = null;
      while (node && node !== document) {
        if (node.tagName === 'A' && node.href) { anchor = node; break; }
        node = node.parentNode;
      }
      if (!anchor) return;
      var href = anchor.href;
      if (!href || href.indexOf('javascript:') === 0) return;
      try {
        var u = new URL(href, window.location.href);
        if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') return;
        var cur = window.location;
        if (u.origin === cur.origin && u.pathname === cur.pathname && u.search === cur.search) return;
      } catch (_) { return; }
      e.preventDefault();
      e.stopImmediatePropagation();
      try { window.open(href, '_blank'); } catch (_) {}
    }, true);
  })();
`;

interface Props {
  node: CanvasNode;
  workspaceId?: string;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  /** When true, overlay a transparent shield above the iframe/webview so
   *  the parent canvas keeps receiving mousemove/mouseup during resize.
   *  Without it, cross-origin iframes (and especially Electron `<webview>`)
   *  swallow the cursor's events and the resize handler stops updating. */
  isResizing?: boolean;
  readOnly?: boolean;
}

// ── Component ────────────────────────────────────────────────────────

export const IframeNodeBody = ({ node, workspaceId, onUpdate, isResizing, readOnly = false }: Props) => {
  const data = node.data as IframeNodeData;
  const mode = data.mode ?? "url";
  const url = data.url ?? "";
  const html = data.html ?? "";
  const savedPrompt = data.prompt ?? "";
  const artifactId = data.artifactId ?? null;

  const { openArtifact } = useArtifactDrawer();

  // ── Artifact-backed iframe: resolve content live from the artifact store ──
  //
  // `mode: 'artifact'` swaps the source of truth from `data.html` (per-node)
  // to the workspace artifact store. The iframe renders the current version
  // of the artifact and re-renders whenever the artifact gets a new version,
  // so iterating from chat updates pinned canvas nodes automatically.
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const isArtifactMode = mode === "artifact" && !!artifactId && !!workspaceId;

  useEffect(() => {
    if (!isArtifactMode || !workspaceId || !artifactId) {
      setArtifact(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const result = await window.canvasWorkspace.artifacts.get(workspaceId, artifactId);
      if (cancelled) return;
      setArtifact((result?.ok ? result.artifact : null) ?? null);
    };
    void refresh();
    const unsubscribe = window.canvasWorkspace.artifacts.onChange((event) => {
      if (event.workspaceId !== workspaceId) return;
      if (event.artifactId !== artifactId) return;
      if (event.kind === "delete") {
        setArtifact(null);
        return;
      }
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isArtifactMode, workspaceId, artifactId]);

  const artifactHtml = (() => {
    if (!artifact) return "";
    const version = artifact.versions.find(v => v.id === artifact.currentVersionId)
      ?? artifact.versions[artifact.versions.length - 1];
    return version?.content ?? "";
  })();

  const hasContent = isArtifactMode ? !!artifactHtml : (mode === "url" ? !!url : !!html);

  // Artifact-backed iframes never enter editing — the artifact store is the
  // single source of truth and the user iterates via the drawer / chat.
  const [editing, setEditing] = useState(!readOnly && !isArtifactMode && !hasContent);
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftHtml, setDraftHtml] = useState(html);
  const [draftPrompt, setDraftPrompt] = useState(savedPrompt);
  const [draftMode, setDraftMode] = useState<EditMode>(mode === "ai" ? "ai" : mode === "html" ? "html" : "url");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [streamingActive, setStreamingActive] = useState(false);
  const [webviewKey, setWebviewKey] = useState(0);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const webviewRef = useRef<WebviewTag | null>(null);

  // ── Streaming refs (avoid re-renders per token) ────────────────────
  const streamIframeRef = useRef<HTMLIFrameElement>(null);
  const streamBuf = useRef("");
  const rafId = useRef(0);
  const shellReady = useRef(false);
  const pendingMorph = useRef<string | null>(null);

  // Keep drafts in sync when data is changed externally.
  useEffect(() => { setDraftUrl(url); }, [url]);
  useEffect(() => { setDraftHtml(html); }, [html]);
  useEffect(() => { setDraftPrompt(savedPrompt); }, [savedPrompt]);
  useEffect(() => { setDraftMode(mode === "ai" ? "ai" : mode === "html" ? "html" : "url"); }, [mode]);

  useEffect(() => {
    if (readOnly || isArtifactMode) setEditing(false);
  }, [readOnly, isArtifactMode]);

  useEffect(() => {
    if (mode !== "url" || editing) {
      setLoadState("idle");
      setLoadError(null);
      return;
    }
    setLoadState(url ? "loading" : "idle");
    setLoadError(null);
  }, [editing, mode, url, webviewKey]);

  useEffect(() => {
    if (mode !== "url" || editing || readOnly) return;
    const el = webviewRef.current;
    if (!el) return;

    const handlePageTitleUpdated = (event: Event) => {
      const rawTitle = sanitizePageTitle((event as Event & { title?: string }).title);
      const nextTitle = url === BLANK_PAGE_URL && rawTitle === BLANK_PAGE_URL ? "Blank page" : rawTitle;
      if (!nextTitle || nextTitle === node.title) return;
      if (!shouldSyncIframeTitle(node.title, data, url)) return;

      onUpdate(node.id, {
        title: nextTitle,
        data: { ...data, pageTitle: nextTitle },
      });
    };

    const handleDidStartLoading = () => {
      setLoadState("loading");
      setLoadError(null);
    };
    const handleDidStopLoading = () => setLoadState((current) => current === "failed" ? current : "ready");
    const handleDidFailLoad = (event: Event) => {
      const detail = event as Event & { errorCode?: number; errorDescription?: string; validatedURL?: string; isMainFrame?: boolean };
      if (detail.isMainFrame === false) return;
      if (detail.errorCode === -3) return; // ERR_ABORTED from user reload/navigation is not a page failure.
      setLoadState("failed");
      setLoadError(detail.errorDescription || "This page failed to load.");
    };

    el.addEventListener("page-title-updated", handlePageTitleUpdated);
    el.addEventListener("did-start-loading", handleDidStartLoading);
    el.addEventListener("did-stop-loading", handleDidStopLoading);
    el.addEventListener("did-fail-load", handleDidFailLoad);
    return () => {
      el.removeEventListener("page-title-updated", handlePageTitleUpdated);
      el.removeEventListener("did-start-loading", handleDidStartLoading);
      el.removeEventListener("did-stop-loading", handleDidStopLoading);
      el.removeEventListener("did-fail-load", handleDidFailLoad);
    };
  }, [data, editing, mode, node.id, node.title, onUpdate, readOnly, url, webviewKey]);

  // Autofocus the relevant input whenever we enter editing mode.
  useEffect(() => {
    if (!editing) return undefined;
    const t = setTimeout(() => {
      if (draftMode === "url") inputRef.current?.select();
      else if (draftMode === "html") textareaRef.current?.focus();
      else promptRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [editing, draftMode]);

  // ── Listen for morph-ready from the streaming shell ────────────────
  useEffect(() => {
    if (!streamingActive) {
      shellReady.current = false;
      return;
    }

    const handler = (e: MessageEvent) => {
      if (e.data?.type === "morph-ready") {
        shellReady.current = true;
        // Flush any HTML that arrived before the shell was ready
        if (pendingMorph.current && streamIframeRef.current?.contentWindow) {
          streamIframeRef.current.contentWindow.postMessage(
            { type: "morph", html: pendingMorph.current }, "*",
          );
          pendingMorph.current = null;
        }
      }
    };

    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      shellReady.current = false;
    };
  }, [streamingActive]);

  // Register the webview's webContents with main (URL mode only).
  useEffect(() => {
    if (editing || mode !== "url") return;
    if (!workspaceId) return;
    const el = webviewRef.current;
    if (!el) return;

    const api = window.canvasWorkspace.iframe;
    let registered = false;

    const tryRegister = (via: string) => {
      if (registered) return;
      try {
        const id = el.getWebContentsId();
        if (typeof id === "number") {
          registered = true;
          void api.registerWebview(workspaceId, node.id, id);
          // eslint-disable-next-line no-console
          console.log(
            `[link-node] registered webContents ${id} for node ${node.id} (via ${via})`,
          );
        }
      } catch (err) {
        if (via === "mount") {
          // eslint-disable-next-line no-console
          console.debug(
            `[link-node] getWebContentsId not ready on mount: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    };

    tryRegister("mount");
    const onAttach = () => tryRegister("did-attach");
    const onDomReady = () => {
      tryRegister("dom-ready");
      // Re-inject on every dom-ready: the SPA may have wiped the document
      // (route change, hard reload) since we last installed the hook.
      try {
        void el.executeJavaScript(LINK_INTERCEPTOR_SCRIPT, false);
      } catch {
        // executeJavaScript can throw if dom-ready races a navigation
        // away — the next dom-ready will retry.
      }
    };
    el.addEventListener("did-attach", onAttach);
    el.addEventListener("dom-ready", onDomReady);

    return () => {
      el.removeEventListener("did-attach", onAttach);
      el.removeEventListener("dom-ready", onDomReady);
      if (registered) {
        void api.unregisterWebview(workspaceId, node.id);
      }
    };
  }, [workspaceId, node.id, editing, url, mode, webviewKey]);

  // ── Send accumulated HTML to the streaming iframe via postMessage ──

  const flushToIframe = useCallback(() => {
    const currentHtml = streamBuf.current;
    const win = streamIframeRef.current?.contentWindow;

    if (win && shellReady.current) {
      win.postMessage({ type: "morph", html: currentHtml }, "*");
    } else {
      pendingMorph.current = currentHtml;
    }
  }, []);

  // ── Commit (URL / HTML) ────────────────────────────────────────────

  const commit = useCallback(() => {
    if (readOnly) return;
    if (draftMode === "url") {
      const next = normalizeUrl(draftUrl.trim());
      const shouldUseAutoTitle = shouldSyncIframeTitle(node.title, data, url);
      onUpdate(node.id, {
        data: { ...data, url: next, mode: "url", pageTitle: "" },
        title: shouldUseAutoTitle && next ? prettyTitle(next) : node.title,
      });
    } else if (draftMode === "html") {
      onUpdate(node.id, {
        data: { ...data, html: draftHtml, mode: "html" },
        title: node.title === "Web" ? "HTML" : node.title,
      });
    }
    setEditing(false);
  }, [draftMode, draftUrl, draftHtml, onUpdate, node.id, node.title, data, readOnly, url]);

  const openBlankPage = useCallback(() => {
    if (readOnly) return;
    const shouldUseAutoTitle = shouldSyncIframeTitle(node.title, data, url);
    onUpdate(node.id, {
      data: { ...data, url: BLANK_PAGE_URL, mode: "url", pageTitle: "" },
      title: shouldUseAutoTitle ? "Blank page" : node.title,
    });
    setDraftUrl(BLANK_PAGE_URL);
    setDraftMode("url");
    setEditing(false);
  }, [data, node.id, node.title, onUpdate, readOnly, url]);

  // ── Streaming AI generation ────────────────────────────────────────

  const startStream = useCallback(async (
    prompt: string,
    opts: { fromEditor?: boolean } = {},
  ) => {
    if (readOnly) return;
    setGenerating(true);
    setGenError(null);
    setStreamingActive(true);
    streamBuf.current = "";
    shellReady.current = false;
    pendingMorph.current = null;

    if (opts.fromEditor) setEditing(false);

    try {
      const llm = window.canvasWorkspace.llm;
      const startResult = await llm.streamHTML(prompt);

      if (!startResult.ok || !startResult.requestId) {
        setGenError(startResult.error ?? "Failed to start generation");
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
            data: { ...data, html: result.html, prompt, mode: "ai" },
            title: node.title === "Web" ? "AI Visual" : node.title,
          });
        } else {
          setGenError(result.error ?? "Generation failed");
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
    setDraftMode(mode === "ai" ? "ai" : mode === "html" ? "html" : "url");
    setGenError(null);
    if (!readOnly) setEditing(false);
  }, [url, html, savedPrompt, mode, readOnly]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    },
    [commit, cancel],
  );

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    },
    [commit, cancel],
  );

  const handlePromptKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleGenerate();
      } else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    },
    [handleGenerate, cancel],
  );

  const handleOpenExternal = useCallback(() => {
    if (mode !== "url") return;
    // Prefer the webview's live URL so the button still works after the user
    // has navigated within the embedded page; fall back to the saved url when
    // the webview hasn't attached yet.
    let target = url;
    try {
      const live = webviewRef.current?.getURL?.();
      if (live && live !== "about:blank") target = live;
    } catch {
      // getURL may throw before did-attach — ignore and keep the saved url.
    }
    if (target) void window.canvasWorkspace.shell.openExternal(target);
  }, [mode, url]);

  const handleOpenDevTools = useCallback(() => {
    const el = webviewRef.current;
    if (!el) return;
    try {
      if (el.isDevToolsOpened?.()) el.closeDevTools?.();
      else el.openDevTools?.();
    } catch {
      // openDevTools throws if the webview hasn't attached yet — silently ignore.
    }
  }, []);

  const handleReload = useCallback(() => {
    setLoadState(mode === "url" && url ? "loading" : "idle");
    setLoadError(null);
    if (mode !== "url") {
      setWebviewKey((k) => k + 1);
      return;
    }
    const el = webviewRef.current;
    if (el && typeof el.reload === "function") {
      try { el.reload(); return; } catch { /* fall through */ }
    }
    setWebviewKey((k) => k + 1);
  }, [mode, url]);

  // ── Editing state ──────────────────────────────────────────────────

  if (editing) {
    const canCommit =
      draftMode === "url" ? !!draftUrl.trim() :
      draftMode === "html" ? !!draftHtml.trim() :
      !!draftPrompt.trim();

    return (
      <div className="iframe-body iframe-body--empty">
        <div className="iframe-empty-inner">
          <div className="iframe-mode-tabs">
            <button
              className={`iframe-mode-tab${draftMode === "url" ? " iframe-mode-tab--active" : ""}`}
              onClick={() => setDraftMode("url")}
              disabled={generating}
            >
              URL
            </button>
            <button
              className={`iframe-mode-tab${draftMode === "html" ? " iframe-mode-tab--active" : ""}`}
              onClick={() => setDraftMode("html")}
              disabled={generating}
            >
              HTML
            </button>
            <button
              className={`iframe-mode-tab${draftMode === "ai" ? " iframe-mode-tab--active" : ""}`}
              onClick={() => setDraftMode("ai")}
              disabled={generating}
            >
              AI
            </button>
          </div>

          {draftMode === "url" ? (
            <>
              <div className="iframe-empty-label">Embed a web page</div>
              <input
                ref={inputRef}
                className="iframe-empty-input"
                type="url"
                value={draftUrl}
                placeholder="https://example.com"
                onChange={(e) => setDraftUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                spellCheck={false}
              />
              <button
                type="button"
                className="iframe-blank-btn"
                onClick={openBlankPage}
                disabled={generating}
              >
                Open blank page
              </button>
            </>
          ) : draftMode === "html" ? (
            <>
              <div className="iframe-empty-label">Render HTML</div>
              <textarea
                ref={textareaRef}
                className="iframe-empty-textarea"
                value={draftHtml}
                placeholder={'<h1>Hello</h1>\n<p>Type your HTML here…</p>'}
                onChange={(e) => setDraftHtml(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                spellCheck={false}
              />
            </>
          ) : (
            <>
              <div className="iframe-empty-label">Describe what to generate</div>
              <textarea
                ref={promptRef}
                className="iframe-empty-textarea iframe-empty-textarea--prompt"
                value={draftPrompt}
                placeholder={"A pie chart showing Q1 revenue by region…\nAn interactive to-do list with drag & drop…\nA flow diagram of the CI/CD pipeline…"}
                onChange={(e) => setDraftPrompt(e.target.value)}
                onKeyDown={handlePromptKeyDown}
                spellCheck={false}
                disabled={generating}
              />
              {genError && (
                <div className="iframe-gen-error">{genError}</div>
              )}
            </>
          )}

          <div className="iframe-empty-actions">
            {hasContent && !generating && (
              <button className="iframe-empty-btn" onClick={cancel}>
                Cancel
              </button>
            )}
            {draftMode === "ai" ? (
              <button
                className="iframe-empty-btn iframe-empty-btn--primary iframe-empty-btn--ai"
                onClick={() => void handleGenerate()}
                disabled={!canCommit || generating}
              >
                {generating ? (
                  <>
                    <span className="iframe-spinner" />
                    Generating…
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M8 1.5l1.85 4.15L14 7.5l-4.15 1.85L8 13.5l-1.85-4.15L2 7.5l4.15-1.85L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                    Generate
                  </>
                )}
              </button>
            ) : (
              <button
                className="iframe-empty-btn iframe-empty-btn--primary"
                onClick={commit}
                disabled={!canCommit}
              >
                {draftMode === "url" ? "Load" : "Render"}
              </button>
            )}
          </div>

          <div className="iframe-empty-hint">
            {draftMode === "url"
              ? 'Type a URL, "blank", or "about:blank". Some sites block embedding.'
              : draftMode === "html"
              ? "Cmd/Ctrl+Enter to confirm. Scripts are sandboxed."
              : "Cmd/Ctrl+Enter to generate. Describe a chart, diagram, UI, or any visual."}
          </div>
        </div>
      </div>
    );
  }

  // ── Rendered state ─────────────────────────────────────────────────

  const renderMode = mode === "url" ? "url" : "html";
  const renderedHtml = isArtifactMode ? artifactHtml : html;

  return (
    <div className="iframe-body">
      <div className="iframe-bar">
        <button
          className="iframe-bar-btn"
          onClick={handleReload}
          title="Reload"
          disabled={generating}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 6a4 4 0 016.9-2.8L10 4M10 2v2.5H7.5M10 6a4 4 0 01-6.9 2.8L2 8M2 10V7.5h2.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {isArtifactMode ? (
          <button
            className="iframe-bar-url iframe-bar-url--html"
            onClick={() => {
              if (workspaceId && artifactId) openArtifact(workspaceId, artifactId);
            }}
            title={artifact?.title ?? "Open artifact"}
          >
            <span className="iframe-bar-badge iframe-bar-badge--ai">Artifact</span>
            <span className="iframe-bar-url-text">
              {artifact?.title ?? "Loading artifact…"}
            </span>
          </button>
        ) : mode === "url" ? (
          <button
            className="iframe-bar-url"
            onClick={() => {
              if (!readOnly) setEditing(true);
            }}
            title={readOnly ? url : "Edit URL"}
          >
            <span className="iframe-bar-url-text">{url}</span>
          </button>
        ) : mode === "ai" ? (
          <button
            className="iframe-bar-url iframe-bar-url--html"
            onClick={() => {
              if (!readOnly && !generating) setEditing(true);
            }}
            title={readOnly ? savedPrompt : generating ? "Generating…" : "Edit prompt"}
          >
            <span className="iframe-bar-badge iframe-bar-badge--ai">AI</span>
            {generating ? (
              <span className="iframe-bar-streaming">
                <span className="iframe-spinner iframe-spinner--small" />
                <span className="iframe-bar-url-text">Generating…</span>
              </span>
            ) : (
              <span className="iframe-bar-url-text">
                {savedPrompt.length > 80 ? savedPrompt.slice(0, 80) + "…" : savedPrompt}
              </span>
            )}
          </button>
        ) : (
          <button
            className="iframe-bar-url iframe-bar-url--html"
            onClick={() => {
              if (!readOnly) setEditing(true);
            }}
            title={readOnly ? html : "Edit HTML"}
          >
            <span className="iframe-bar-badge">HTML</span>
            <span className="iframe-bar-url-text">
              {html.length > 80 ? html.slice(0, 80) + "…" : html}
            </span>
          </button>
        )}

        {mode === "ai" && !generating && !readOnly && (
          <button
            className="iframe-bar-btn"
            onClick={() => void handleRegenerate()}
            title="Regenerate"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5l1.85 4.15L14 7.5l-4.15 1.85L8 13.5l-1.85-4.15L2 7.5l4.15-1.85L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {mode === "url" && (
          <button
            className="iframe-bar-btn"
            onClick={handleOpenDevTools}
            title="Inspect (open DevTools)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="5" cy="5" r="3" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7.5 7.5L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {mode === "url" && (
          <button
            className="iframe-bar-btn"
            onClick={handleOpenExternal}
            title="Open externally"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M5 2H2.5A.5.5 0 002 2.5v7A.5.5 0 002.5 10h7a.5.5 0 00.5-.5V7M7 2h3v3M5.5 6.5L10 2"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>

      <div className={`iframe-frame-wrapper${streamingActive ? " iframe-frame-wrapper--streaming" : ""}`}>
        {streamingActive && <div className="iframe-shimmer-bar" />}
        {isResizing && <div className="iframe-pointer-shield" aria-hidden="true" />}
        {renderMode === "url" ? (
          <>
            <webview
              ref={webviewRef as unknown as React.Ref<HTMLWebViewElement>}
              key={webviewKey}
              className="iframe-frame"
              src={url}
              allowpopups={true as unknown as undefined}
            />
            {loadState === "failed" && (
              <div className="iframe-load-error">
                <div className="iframe-load-error-card">
                  <div className="iframe-load-error-title">Page failed to load</div>
                  <div className="iframe-load-error-message">
                    {loadError ?? "The embedded page could not be displayed."}
                  </div>
                  <div className="iframe-load-error-actions">
                    <button type="button" className="iframe-empty-btn iframe-empty-btn--primary" onClick={handleReload}>
                      Reload
                    </button>
                    <button type="button" className="iframe-empty-btn" onClick={handleOpenExternal}>
                      Open externally
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : streamingActive ? (
          <iframe
            ref={streamIframeRef}
            key="stream-shell"
            className="iframe-frame"
            srcDoc={STREAMING_SHELL}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            title="Generating…"
          />
        ) : (
          <iframe
            key={isArtifactMode ? `artifact-${artifact?.currentVersionId ?? "loading"}` : webviewKey}
            className="iframe-frame"
            srcDoc={renderedHtml}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            title={
              isArtifactMode
                ? `Artifact: ${artifact?.title ?? "loading"}`
                : mode === "ai" ? "AI-generated preview" : "HTML preview"
            }
          />
        )}
      </div>
    </div>
  );
};

function normalizeUrl(input: string): string {
  if (!input) return "";
  const lowered = input.toLowerCase();
  if (lowered === "blank" || lowered === BLANK_PAGE_URL) return BLANK_PAGE_URL;
  if (/^[a-z]+:\/\//i.test(input)) return input;
  if (/^\/\//.test(input)) return `https:${input}`;
  return `https://${input}`;
}

function prettyTitle(url: string): string {
  if (url === BLANK_PAGE_URL) return "Blank page";
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url;
  }
}

function sanitizePageTitle(title: string | undefined): string {
  return (title ?? "").replace(/\s+/g, " ").trim();
}

function shouldSyncIframeTitle(title: string, data: IframeNodeData, url: string): boolean {
  const currentTitle = title.trim();
  const urlTitle = url ? prettyTitle(url) : "";
  const previousPageTitle = sanitizePageTitle(data.pageTitle);

  return (
    !currentTitle
    || currentTitle === "Web"
    || currentTitle === urlTitle
    || (!!previousPageTitle && currentTitle === previousPageTitle)
  );
}

interface WebviewTag extends HTMLElement {
  getWebContentsId(): number;
  getURL(): string;
  reload(): void;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
}
