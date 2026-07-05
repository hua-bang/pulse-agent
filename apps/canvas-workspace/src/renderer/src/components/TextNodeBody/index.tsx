import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import "./index.css";
import { TextSelectionBubble } from "./TextSelectionBubble";
import { createTextNodeExtensions } from "./textNodeExtensions";
import type { CanvasNode, TextNodeData } from "../../types";
import { isImeComposing } from "../../utils/ime";
import { useI18n } from "../../i18n";

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (e: React.MouseEvent, node: CanvasNode) => void;
  readOnly?: boolean;
}

/* ---------------------------------------------------------------------------
 * TLDRAW-style text node body (tiptap-backed).
 *
 * Design:
 *  - Tiptap gives true WYSIWYG, robust IME handling, and all the markdown
 *    keyboard shortcuts for free. Content is stored as HTML in
 *    node.data.content so that line breaks, paragraphs, and formatting
 *    survive a save/reload cycle without lossy markdown round-trips.
 *  - The tiptap-markdown extension is still loaded for a small Markdown
 *    subset (`#`, lists, quote, inline marks, paste-as-markdown). Heavier
 *    document blocks like code fences and dividers belong in Note cards.
 *  - Idle state: editor is non-editable. Clicks hit our outer wrapper and
 *    start a drag; the node feels like a label.
 *  - Editing: double-click flips the editor to editable and focuses it.
 *    Blur, Escape, or deselection commits the edit.
 *
 * Size:
 *  - `data.autoSize !== false` (default) → wrapper tracks content via CSS
 *    `max-content`. useLayoutEffect persists the measured size so Canvas
 *    hit-testing / frame containment stay in sync.
 *  - After a resize-handle drag (CanvasNodeView flips `autoSize` to false),
 *    node.width/height becomes a fixed frame; text wraps inside and the
 *    .node-body clips overflow.
 * ------------------------------------------------------------------------- */

export const TextNodeBody = ({ node, onUpdate, isSelected, onSelect, onDragStart, readOnly = false }: Props) => {
  const { t } = useI18n();
  const data = node.data as TextNodeData;
  const autoSize = data.autoSize !== false;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [, rerenderStyleControls] = useState(0);

  // Refs that onUpdate / editor callbacks need without re-registering on every
  // keystroke. This is the same pattern useFileNodeEditor uses for the note
  // editor.
  const dataRef = useRef(data);
  dataRef.current = data;
  const nodeIdRef = useRef(node.id);
  nodeIdRef.current = node.id;
  const prevContentRef = useRef(data.content);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const editor = useEditor({
    extensions: createTextNodeExtensions(t('canvas.textPlaceholder')),
    content: data.content || "",
    editable: false,
    onUpdate: ({ editor }) => {
      if (readOnly) return;
      // Persist as HTML so line breaks survive reload without a lossy
      // markdown round-trip.
      const html = editor.getHTML();
      if (html === dataRef.current.content) return;
      prevContentRef.current = html;
      onUpdateRef.current(nodeIdRef.current, {
        data: { ...dataRef.current, content: html },
      });
    },
    onBlur: () => {
      if (!readOnly) setEditing(false);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const refresh = () => rerenderStyleControls((value) => value + 1);
    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
    };
  }, [editor]);

  // Sync the editable flag with our `editing` state. Tiptap's options are
  // captured once, so we toggle imperatively.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly && editing);
  }, [editor, editing, readOnly]);

  // External content change (undo/redo, CLI edit, duplicate-paste) — reset
  // the editor so it mirrors node.data without clobbering user typing.
  useEffect(() => {
    if (!editor) return;
    if (data.content === prevContentRef.current) return;
    prevContentRef.current = data.content;
    // `emitUpdate: false` avoids firing our onUpdate → onUpdate loop.
    editor.commands.setContent(data.content || "", { emitUpdate: false });
  }, [editor, data.content]);

  // First-mount: empty-content nodes drop straight into editing so typing
  // works immediately without an extra double-click.
  useEffect(() => {
    if (!editor) return;
    if (!readOnly && data.content === "") {
      setEditing(true);
      // Defer focus until editable=true has applied to the DOM.
      const t = setTimeout(() => editor.commands.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [editor, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deselection commits the edit — matches tldraw's click-away-to-finalize feel.
  useEffect(() => {
    if (!isSelected && editing) {
      setEditing(false);
      editor?.commands.blur();
    }
  }, [isSelected, editing, editor]);

  // Enter / F2 on a selected (but not yet editing) text node → drop into edit
  // mode with the caret at the end. Matches Figma / tldraw / Excalidraw. Without
  // this, a user who single-clicks a populated text node and tries to type sees
  // nothing happen: drag mode swallows the click, the "Double-click to edit"
  // placeholder only shows on empty nodes, and no other hint exists. Capture
  // phase + defaultPrevented dedupe means multi-select picks one winner.
  useEffect(() => {
    if (!editor || !isSelected || editing || readOnly) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "Enter" && e.key !== "F2") return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (
        active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable
      )) return;
      e.preventDefault();
      setEditing(true);
      requestAnimationFrame(() => editor.commands.focus("end"));
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [editor, isSelected, editing, readOnly]);

  // Auto-size the wrapper to fit content. Height ALWAYS tracks content so a
  // text node can never clip or scroll (prosemirror's auto-scroll-into-view
  // would otherwise push the top of the text off-screen). Width is
  // content-driven only while `autoSize` is true; once the user drags the
  // right handle it becomes the authoritative wrap width.
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (!autoSize && node.height === el.offsetHeight) return;
    const measuredW = Math.max(40, Math.ceil(el.offsetWidth));
    const measuredH = Math.max(28, Math.ceil(el.offsetHeight));
    const patch: Partial<CanvasNode> = {};
    if (autoSize && Math.abs(measuredW - node.width) > 1) {
      patch.width = measuredW;
    }
    if (Math.abs(measuredH - node.height) > 1) {
      patch.height = measuredH;
    }
    if (!readOnly && (patch.width !== undefined || patch.height !== undefined)) {
      onUpdate(node.id, patch);
    }
  });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) {
        e.stopPropagation();
        return;
      }
      if (editing) {
        // Let prosemirror handle caret placement / text selection; just make
        // sure the wrapper's drag listeners don't fire.
        e.stopPropagation();
        return;
      }
      onSelect(node.id);
      onDragStart(e, node);
    },
    [editing, node, onSelect, onDragStart, readOnly]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly || editing) return;
      setEditing(true);
      setTimeout(() => editor?.commands.focus(), 0);
    },
    [editing, editor, readOnly]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (readOnly) return;
      // Escape mid-IME-composition dismisses the candidate window — exiting
      // edit mode there would eat the half-typed CJK input.
      if (isImeComposing(e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        editor?.commands.blur();
        setEditing(false);
      }
    },
    [editor, readOnly]
  );

  return (
    <div
      ref={wrapperRef}
      className={`text-node-body${editing ? " text-node-body--editing" : ""}`}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      style={{
        color: data.textColor,
        backgroundColor: data.backgroundColor,
        fontSize: data.fontSize ?? 18,
      }}
    >
      {editor && !readOnly && <TextSelectionBubble editor={editor} editing={editing} />}
      <EditorContent editor={editor} />
    </div>
  );
};
