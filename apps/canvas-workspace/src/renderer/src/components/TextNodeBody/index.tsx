import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./index.css";
import type { CanvasNode, TextNodeData } from "../../types";

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (e: React.MouseEvent, node: CanvasNode) => void;
}

/**
 * TLDRAW-style text node body.
 *
 * UX model:
 *  - Idle: node reads as pure text on the canvas — no card, no title chrome.
 *  - Click + drag: moves the node (like tldraw's text shape).
 *  - Double-click: enters editing mode. Caret appears and keystrokes edit.
 *  - Blur / Escape / deselect: exits editing mode.
 *
 * The wrapper's width/height are driven by the text body's intrinsic size
 * (`width: max-content` in CSS). After layout we measure and write the actual
 * size back to `node.width` / `node.height` so hit-testing, frame containment,
 * and spatial queries stay in sync with what's rendered.
 */
export const TextNodeBody = ({ node, onUpdate, isSelected, onSelect, onDragStart }: Props) => {
  const data = node.data as TextNodeData;
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);

  // Keep the DOM innerText aligned with `data.content` without clobbering the
  // caret on every keystroke. We only overwrite when the values diverge — e.g.
  // after undo/redo, a canvas-cli edit, or a duplicate-paste.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerText !== data.content) {
      el.innerText = data.content;
    }
  }, [data.content]);

  // Auto-size the wrapper to fit the text body. `.canvas-node--text` uses
  // `width: max-content` in CSS so the rendered size already fits content;
  // this effect just persists that measurement back to the node model so
  // Canvas hit-testing / frame containment use the real rendered bounds.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = Math.max(40, Math.ceil(el.offsetWidth));
    const h = Math.max(28, Math.ceil(el.offsetHeight));
    if (Math.abs(w - node.width) > 1 || Math.abs(h - node.height) > 1) {
      onUpdate(node.id, { width: w, height: h });
    }
  });

  // First-mount: if the node was just created with empty content, drop
  // straight into editing mode so typing works immediately.
  useEffect(() => {
    if (data.content === "" && ref.current) {
      setEditing(true);
      const el = ref.current;
      const t = setTimeout(() => el.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Deselecting exits editing — matches tldraw (clicking away finalizes edit).
  useEffect(() => {
    if (!isSelected && editing) {
      setEditing(false);
      ref.current?.blur();
    }
  }, [isSelected, editing]);

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      const next = e.currentTarget.innerText;
      if (next !== data.content) {
        onUpdate(node.id, { data: { ...data, content: next } });
      }
    },
    [node.id, data, onUpdate]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (editing) {
        // In editing mode, mousedown places the caret / starts a selection.
        // Stop here so the wrapper doesn't try to drag the node.
        e.stopPropagation();
        return;
      }
      // Not editing → click-drag moves the node, tldraw-style.
      onSelect(node.id);
      onDragStart(e, node);
    },
    [editing, node, onSelect, onDragStart]
  );

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
    // contentEditable="true" is applied after the state flush; focus once
    // it's in the DOM so the caret lands where the user double-clicked.
    setTimeout(() => ref.current?.focus(), 0);
  }, []);

  const handleBlur = useCallback(() => {
    setEditing(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      ref.current?.blur();
      setEditing(false);
    }
  }, []);

  return (
    <div
      ref={ref}
      className={`text-node-body${editing ? " text-node-body--editing" : ""}`}
      contentEditable={editing}
      suppressContentEditableWarning
      spellCheck={false}
      onInput={handleInput}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      style={{
        color: data.textColor,
        backgroundColor: data.backgroundColor,
        fontSize: data.fontSize ?? 18,
      }}
      data-placeholder="Type something…"
    />
  );
};

/* ---- Color pickers (rendered in the hover/selected header) ---- */

const TEXT_COLOR_PRESETS: Array<{ name: string; value: string }> = [
  { name: "Black", value: "#1f2328" },
  { name: "Gray", value: "#6b7280" },
  { name: "Red", value: "#e03131" },
  { name: "Orange", value: "#f08c00" },
  { name: "Yellow", value: "#e8b800" },
  { name: "Green", value: "#2f9e44" },
  { name: "Blue", value: "#1c7ed6" },
  { name: "Purple", value: "#7048e8" },
  { name: "White", value: "#ffffff" },
];

const BG_COLOR_PRESETS: Array<{ name: string; value: string }> = [
  { name: "None", value: "transparent" },
  { name: "White", value: "#ffffff" },
  { name: "Gray", value: "#e9ecef" },
  { name: "Red", value: "#ffe3e3" },
  { name: "Orange", value: "#ffe8cc" },
  { name: "Yellow", value: "#fff3bf" },
  { name: "Green", value: "#d3f9d8" },
  { name: "Blue", value: "#d0ebff" },
  { name: "Purple", value: "#e5dbff" },
];

type PickerKind = "text" | "bg";

const TextColorTrigger = ({
  node,
  onUpdate,
  kind,
}: {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  kind: PickerKind;
}) => {
  const data = node.data as TextNodeData;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  const currentValue = kind === "text" ? data.textColor : data.backgroundColor;
  const presets = kind === "text" ? TEXT_COLOR_PRESETS : BG_COLOR_PRESETS;
  const title = kind === "text" ? "Text color" : "Background color";

  const handlePick = useCallback(
    (value: string) => {
      const patch: Partial<TextNodeData> =
        kind === "text" ? { textColor: value } : { backgroundColor: value };
      onUpdate(node.id, { data: { ...data, ...patch } });
      setOpen(false);
    },
    [kind, node.id, data, onUpdate]
  );

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const isTransparent = currentValue === "transparent";

  return (
    <div
      ref={triggerRef}
      className={`text-color-trigger${open ? " text-color-trigger--open" : ""}`}
      title={title}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className={`text-color-dot${isTransparent ? " text-color-dot--transparent" : ""}`}
        style={{ backgroundColor: isTransparent ? undefined : currentValue }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {kind === "text" && <span className="text-color-dot-glyph">A</span>}
      </div>
      {open && (
        <div className="text-color-popover text-color-popover--open">
          {presets.map((preset) => {
            const active = currentValue === preset.value;
            const isNone = preset.value === "transparent";
            return (
              <button
                key={preset.name}
                className={
                  "text-color-swatch" +
                  (active ? " text-color-swatch--active" : "") +
                  (isNone ? " text-color-swatch--none" : "")
                }
                style={{
                  backgroundColor: isNone ? undefined : preset.value,
                }}
                title={preset.name}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePick(preset.value);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export const TextColorPicker = ({
  node,
  onUpdate,
}: {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}) => (
  <>
    <TextColorTrigger node={node} onUpdate={onUpdate} kind="text" />
    <TextColorTrigger node={node} onUpdate={onUpdate} kind="bg" />
  </>
);
