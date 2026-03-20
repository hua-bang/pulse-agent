import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasNode, FileNodeData } from "../types";

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}

const AUTO_SAVE_MS = 1500;

const renderMarkdown = (md: string): string => {
  let html = md;
  // headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // bold / italic / code
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/`(.+?)`/g, '<code class="note-inline-code">$1</code>');
  // hr
  html = html.replace(/^---$/gm, "<hr />");
  // unordered list
  html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  // checkboxes
  html = html.replace(
    /\[x\]/gi,
    '<input type="checkbox" checked disabled />'
  );
  html = html.replace(/\[ \]/g, '<input type="checkbox" disabled />');
  // blockquote
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
  // paragraphs (lines that aren't already wrapped)
  html = html.replace(
    /^(?!<[a-z])((?!<\/)[^\n]+)$/gm,
    (_, line) => `<p>${line}</p>`
  );
  // collapse consecutive <blockquote>
  html = html.replace(/<\/blockquote>\s*<blockquote>/g, "<br />");
  return html;
};

export const FileNodeBody = ({ node, onUpdate }: Props) => {
  const data = node.data as FileNodeData;
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [content, setContent] = useState(data.content || "");
  const [modified, setModified] = useState(false);
  const [statusText, setStatusText] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const dataRef = useRef(data);
  dataRef.current = data;
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Sync when data.content changes externally (e.g. file open)
  useEffect(() => {
    if (data.content !== contentRef.current) {
      setContent(data.content || "");
      setModified(false);
    }
  }, [data.content]);

  const showStatus = useCallback((msg: string, duration = 2000) => {
    setStatusText(msg);
    setTimeout(() => setStatusText(""), duration);
  }, []);

  const persistToFile = useCallback(
    async (text: string, filePath: string) => {
      const api = window.canvasWorkspace?.file;
      if (!api || !filePath) return;
      const res = await api.write(filePath, text);
      if (res.ok) {
        setModified(false);
        onUpdate(node.id, {
          data: { ...dataRef.current, content: text, saved: true, modified: false }
        });
        showStatus("Saved");
      }
    },
    [node.id, onUpdate, showStatus]
  );

  const scheduleAutoSave = useCallback(
    (text: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const fp = dataRef.current.filePath;
        if (fp) void persistToFile(text, fp);
      }, AUTO_SAVE_MS);
    },
    [persistToFile]
  );

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setContent(val);
      setModified(true);
      onUpdate(node.id, {
        data: { ...dataRef.current, content: val, modified: true }
      });
      scheduleAutoSave(val);
    },
    [onUpdate, node.id, scheduleAutoSave]
  );

  // Keyboard shortcut: Cmd+S / Ctrl+S
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        const fp = dataRef.current.filePath;
        if (fp) void persistToFile(contentRef.current, fp);
      }
    },
    [persistToFile]
  );

  // Tab in textarea inserts spaces
  const handleTab = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const newVal = val.substring(0, start) + "  " + val.substring(end);
      setContent(newVal);
      onUpdate(node.id, {
        data: { ...dataRef.current, content: newVal, modified: true }
      });
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [node.id, onUpdate]);

  const handleOpenFile = useCallback(async () => {
    const api = window.canvasWorkspace?.file;
    if (!api) return;
    const res = await api.openDialog();
    if (!res.ok || res.canceled) return;
    setContent(res.content || "");
    setModified(false);
    onUpdate(node.id, {
      title: res.fileName || node.title,
      data: {
        filePath: res.filePath || "",
        content: res.content || "",
        saved: true,
        modified: false
      }
    });
    showStatus(`Opened ${res.fileName}`);
  }, [node.id, node.title, onUpdate, showStatus]);

  const handleSaveAs = useCallback(async () => {
    const api = window.canvasWorkspace?.file;
    if (!api) return;
    const defaultName = dataRef.current.filePath
      ? dataRef.current.filePath.split("/").pop() || "untitled.md"
      : (node.title || "untitled") + ".md";
    const res = await api.saveAsDialog(defaultName, contentRef.current);
    if (!res.ok || res.canceled) return;
    setModified(false);
    onUpdate(node.id, {
      title: res.fileName || node.title,
      data: {
        ...dataRef.current,
        filePath: res.filePath || dataRef.current.filePath,
        content: contentRef.current,
        saved: true,
        modified: false
      }
    });
    showStatus(`Saved to ${res.fileName}`);
  }, [node.id, node.title, onUpdate, showStatus]);

  const handleManualSave = useCallback(() => {
    const fp = dataRef.current.filePath;
    if (fp) {
      void persistToFile(contentRef.current, fp);
    } else {
      void handleSaveAs();
    }
  }, [persistToFile, handleSaveAs]);

  // Format toolbar actions
  const insertFormat = useCallback(
    (before: string, after = "") => {
      const ta = editorRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const selected = val.substring(start, end);
      const newVal =
        val.substring(0, start) + before + selected + after + val.substring(end);
      setContent(newVal);
      setModified(true);
      onUpdate(node.id, {
        data: { ...dataRef.current, content: newVal, modified: true }
      });
      scheduleAutoSave(newVal);
      requestAnimationFrame(() => {
        ta.focus();
        ta.selectionStart = start + before.length;
        ta.selectionEnd = start + before.length + selected.length;
      });
    },
    [node.id, onUpdate, scheduleAutoSave]
  );

  const filePath = data.filePath;
  const fileName = filePath ? filePath.split("/").pop() : null;

  return (
    <div className="note-card" onKeyDown={handleKeyDown}>
      {/* Toolbar */}
      <div className="note-toolbar">
        <div className="note-toolbar-left">
          <button
            className="note-tool-btn"
            onClick={handleOpenFile}
            title="Open file"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 4.5C2 3.67 2.67 3 3.5 3H6l1.5 2h5c.83 0 1.5.67 1.5 1.5V12c0 .83-.67 1.5-1.5 1.5h-9A1.5 1.5 0 012 12V4.5z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </button>
          <button
            className="note-tool-btn"
            onClick={handleManualSave}
            title="Save (Cmd+S)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M12.5 14h-9A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2H10l4 4v6.5a1.5 1.5 0 01-1.5 1.5z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path d="M5 2v4h5V2" stroke="currentColor" strokeWidth="1.2" />
              <path d="M5 10h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="note-tool-btn"
            onClick={handleSaveAs}
            title="Save as..."
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M12.5 14h-9A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2H10l4 4v6.5a1.5 1.5 0 01-1.5 1.5z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path d="M8 7v5M6 10l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <span className="note-toolbar-divider" />

          <button
            className="note-tool-btn"
            onClick={() => insertFormat("**", "**")}
            title="Bold"
          >
            <strong style={{ fontSize: 12 }}>B</strong>
          </button>
          <button
            className="note-tool-btn"
            onClick={() => insertFormat("*", "*")}
            title="Italic"
          >
            <em style={{ fontSize: 12 }}>I</em>
          </button>
          <button
            className="note-tool-btn"
            onClick={() => insertFormat("`", "`")}
            title="Code"
          >
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>&lt;/&gt;</span>
          </button>
          <button
            className="note-tool-btn"
            onClick={() => insertFormat("# ")}
            title="Heading"
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>H</span>
          </button>
          <button
            className="note-tool-btn"
            onClick={() => insertFormat("- ")}
            title="List"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M6 4h7M6 8h7M6 12h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="3.5" cy="4" r="1" fill="currentColor" />
              <circle cx="3.5" cy="8" r="1" fill="currentColor" />
              <circle cx="3.5" cy="12" r="1" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div className="note-toolbar-right">
          {statusText && <span className="note-status">{statusText}</span>}
          {modified && !statusText && (
            <span className="note-status note-status--modified">Edited</span>
          )}
          <button
            className={`note-tool-btn note-tool-btn--toggle ${mode === "preview" ? "note-tool-btn--active" : ""}`}
            onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
            title={mode === "edit" ? "Preview" : "Edit"}
          >
            {mode === "edit" ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M12.5 3.5l-9 9M3.5 3.5l4 4"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* File path hint */}
      {fileName && (
        <div className="note-file-hint" title={filePath}>
          {fileName}
        </div>
      )}

      {/* Editor / Preview */}
      <div className="note-content">
        {mode === "edit" ? (
          <textarea
            ref={editorRef}
            className="note-editor"
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleTab}
            placeholder="Start writing..."
            spellCheck={false}
          />
        ) : (
          <div
            className="note-preview"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(content || "*No content yet*")
            }}
          />
        )}
      </div>
    </div>
  );
};
