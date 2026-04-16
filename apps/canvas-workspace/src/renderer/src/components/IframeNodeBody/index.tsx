import { useCallback, useEffect, useRef, useState } from "react";
import "./index.css";
import type { CanvasNode, IframeNodeData } from "../../types";

type EditMode = "url" | "html" | "ai";

interface Props {
  node: CanvasNode;
  workspaceId?: string;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}

/**
 * Renders an external web page in an Electron `<webview>` tag, renders
 * user-supplied HTML in a sandboxed `<iframe srcdoc>`, or generates HTML
 * from a natural-language prompt via the configured LLM.
 *
 * URL mode (`mode: 'url'`, default):
 *   Uses Electron `<webview>` to embed a remote page.
 *
 * HTML mode (`mode: 'html'`):
 *   Renders raw HTML the user typed via `<iframe srcdoc>`.
 *
 * AI mode (`mode: 'ai'`):
 *   The user types a prompt, the LLM generates self-contained HTML, and
 *   the result is rendered the same way as HTML mode. The prompt is
 *   persisted so the user can regenerate or refine later.
 */
export const IframeNodeBody = ({ node, workspaceId, onUpdate }: Props) => {
  const data = node.data as IframeNodeData;
  const mode = data.mode ?? "url";
  const url = data.url ?? "";
  const html = data.html ?? "";
  const savedPrompt = data.prompt ?? "";

  const hasContent = mode === "url" ? !!url : !!html;

  const [editing, setEditing] = useState(!hasContent);
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftHtml, setDraftHtml] = useState(html);
  const [draftPrompt, setDraftPrompt] = useState(savedPrompt);
  const [draftMode, setDraftMode] = useState<EditMode>(mode === "ai" ? "ai" : mode === "html" ? "html" : "url");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [webviewKey, setWebviewKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const webviewRef = useRef<WebviewTag | null>(null);

  // Keep drafts in sync when data is changed externally (undo/redo, CLI edits).
  useEffect(() => { setDraftUrl(url); }, [url]);
  useEffect(() => { setDraftHtml(html); }, [html]);
  useEffect(() => { setDraftPrompt(savedPrompt); }, [savedPrompt]);
  useEffect(() => { setDraftMode(mode === "ai" ? "ai" : mode === "html" ? "html" : "url"); }, [mode]);

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
    const onDomReady = () => tryRegister("dom-ready");
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

  // ── Commit (URL / HTML) ────────────────────────────────────────────

  const commit = useCallback(() => {
    if (draftMode === "url") {
      const next = normalizeUrl(draftUrl.trim());
      onUpdate(node.id, {
        data: { ...data, url: next, mode: "url" },
        title: next ? prettyTitle(next) : node.title,
      });
    } else if (draftMode === "html") {
      onUpdate(node.id, {
        data: { ...data, html: draftHtml, mode: "html" },
        title: node.title === "Web" ? "HTML" : node.title,
      });
    }
    setEditing(false);
  }, [draftMode, draftUrl, draftHtml, onUpdate, node.id, node.title, data]);

  // ── Generate (AI mode) ─────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    const prompt = draftPrompt.trim();
    if (!prompt) return;

    setGenerating(true);
    setGenError(null);

    try {
      const result = await window.canvasWorkspace.llm.generateHTML(prompt);
      if (result.ok && result.html) {
        onUpdate(node.id, {
          data: { ...data, html: result.html, prompt, mode: "ai" },
          title: node.title === "Web" ? "AI Visual" : node.title,
        });
        setEditing(false);
      } else {
        setGenError(result.error ?? "Failed to generate HTML");
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, [draftPrompt, onUpdate, node.id, node.title, data]);

  // ── Regenerate from rendered state ─────────────────────────────────

  const handleRegenerate = useCallback(async () => {
    if (!savedPrompt.trim()) return;
    setGenerating(true);
    setGenError(null);

    try {
      const result = await window.canvasWorkspace.llm.generateHTML(savedPrompt.trim());
      if (result.ok && result.html) {
        onUpdate(node.id, {
          data: { ...data, html: result.html },
        });
        setWebviewKey((k) => k + 1);
      }
    } catch {
      // silent — the user can click edit to see what went wrong
    } finally {
      setGenerating(false);
    }
  }, [savedPrompt, onUpdate, node.id, data]);

  const cancel = useCallback(() => {
    setDraftUrl(url);
    setDraftHtml(html);
    setDraftPrompt(savedPrompt);
    setDraftMode(mode === "ai" ? "ai" : mode === "html" ? "html" : "url");
    setGenError(null);
    setEditing(false);
  }, [url, html, savedPrompt, mode]);

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
    if (mode === "url" && url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [mode, url]);

  const handleReload = useCallback(() => {
    if (mode !== "url") {
      setWebviewKey((k) => k + 1);
      return;
    }
    const el = webviewRef.current;
    if (el && typeof el.reload === "function") {
      try { el.reload(); return; } catch { /* fall through */ }
    }
    setWebviewKey((k) => k + 1);
  }, [mode]);

  // ── Editing state ──────────────────────────────────────────────────

  if (editing) {
    const canCommit =
      draftMode === "url" ? !!draftUrl.trim() :
      draftMode === "html" ? !!draftHtml.trim() :
      !!draftPrompt.trim();

    return (
      <div className="iframe-body iframe-body--empty">
        <div className="iframe-empty-inner">
          {/* Tab switcher */}
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
              ? 'Some sites block embedding — use "Open externally" to fall back to a browser.'
              : draftMode === "html"
              ? "Cmd/Ctrl+Enter to confirm. Scripts are sandboxed."
              : "Cmd/Ctrl+Enter to generate. Describe a chart, diagram, UI, or any visual."}
          </div>
        </div>
      </div>
    );
  }

  // ── Rendered state ─────────────────────────────────────────────────

  const renderMode = mode === "url" ? "url" : "html"; // ai also renders as html

  return (
    <div className="iframe-body">
      <div className="iframe-bar">
        <button
          className="iframe-bar-btn"
          onClick={handleReload}
          title="Reload"
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

        {mode === "url" ? (
          <button
            className="iframe-bar-url"
            onClick={() => setEditing(true)}
            title="Edit URL"
          >
            <span className="iframe-bar-url-text">{url}</span>
          </button>
        ) : mode === "ai" ? (
          <button
            className="iframe-bar-url iframe-bar-url--html"
            onClick={() => setEditing(true)}
            title="Edit prompt"
          >
            <span className="iframe-bar-badge iframe-bar-badge--ai">AI</span>
            <span className="iframe-bar-url-text">
              {savedPrompt.length > 80 ? savedPrompt.slice(0, 80) + "…" : savedPrompt}
            </span>
          </button>
        ) : (
          <button
            className="iframe-bar-url iframe-bar-url--html"
            onClick={() => setEditing(true)}
            title="Edit HTML"
          >
            <span className="iframe-bar-badge">HTML</span>
            <span className="iframe-bar-url-text">
              {html.length > 80 ? html.slice(0, 80) + "…" : html}
            </span>
          </button>
        )}

        {mode === "ai" && (
          <button
            className="iframe-bar-btn"
            onClick={() => void handleRegenerate()}
            title="Regenerate"
            disabled={generating}
          >
            {generating ? (
              <span className="iframe-spinner iframe-spinner--small" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 1.5l1.85 4.15L14 7.5l-4.15 1.85L8 13.5l-1.85-4.15L2 7.5l4.15-1.85L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            )}
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

      {renderMode === "url" ? (
        <webview
          ref={webviewRef as unknown as React.Ref<HTMLWebViewElement>}
          key={webviewKey}
          className="iframe-frame"
          src={url}
          allowpopups={true as unknown as undefined}
        />
      ) : (
        <iframe
          key={webviewKey}
          className="iframe-frame"
          srcDoc={html}
          sandbox="allow-scripts"
          title={mode === "ai" ? "AI-generated preview" : "HTML preview"}
        />
      )}
    </div>
  );
};

function normalizeUrl(input: string): string {
  if (!input) return "";
  if (/^[a-z]+:\/\//i.test(input)) return input;
  if (/^\/\//.test(input)) return `https:${input}`;
  return `https://${input}`;
}

function prettyTitle(url: string): string {
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url;
  }
}

interface WebviewTag extends HTMLElement {
  getWebContentsId(): number;
  reload(): void;
}
