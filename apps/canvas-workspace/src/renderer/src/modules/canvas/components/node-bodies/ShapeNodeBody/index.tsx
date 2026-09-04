import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import './index.css';
import type { CanvasNode, ShapeNodeData } from '../../../../../types';
import { ShapePrimitive } from '../../../model/shapeGeometry';
import { isImeComposing } from '../../../../../utils/ime';

export { ShapeStylePicker } from './ShapeStylePicker';

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (e: React.MouseEvent, node: CanvasNode) => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  readOnly?: boolean;
}

/**
 * Shape node body. Renders a single SVG primitive (rect or ellipse) that
 * fills the node box, plus an optional centered text label overlaid on
 * top. The entire surface is a drag handle, mirroring the chromeless
 * image/text bodies.
 *
 * The stroke is drawn inside the viewport by insetting the geometry by
 * half the stroke width — without the inset, SVG centers the stroke on
 * the edge so half of it clips outside the node bounds.
 *
 * Text editing: double-click enters edit mode; Escape or blur commits.
 * While editing, the contenteditable div captures pointer events so the
 * user can click-to-position the caret without starting a drag.
 */
export const ShapeNodeBody = ({ node, isSelected, onSelect, onDragStart, onUpdate, readOnly = false }: Props) => {
  const data = node.data as ShapeNodeData;
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  // Sync the editor's DOM text back to React state only on commit — while
  // editing we let the browser own the DOM so the caret doesn't jump on
  // every keystroke.
  const initialTextRef = useRef<string>(data.text ?? '');

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) {
        e.stopPropagation();
        return;
      }
      if (editing) return;
      onSelect(node.id);
      onDragStart(e, node);
    },
    [editing, node, onSelect, onDragStart, readOnly],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      initialTextRef.current = data.text ?? '';
      setEditing(true);
    },
    [data.text, readOnly],
  );

  const commit = useCallback(() => {
    const el = editorRef.current;
    if (!el) {
      setEditing(false);
      return;
    }
    const next = el.innerText.replace(/\n+$/, '');
    setEditing(false);
    if (!readOnly && next !== (data.text ?? '')) {
      onUpdate(node.id, { data: { ...data, text: next } });
    }
  }, [data, node.id, onUpdate, readOnly]);

  const cancel = useCallback(() => {
    // Restore the pre-edit text and exit without saving.
    const el = editorRef.current;
    if (el) el.innerText = initialTextRef.current;
    setEditing(false);
  }, []);

  // Auto-focus and select-all when entering edit mode so the user can
  // immediately type a replacement or extend existing text.
  useLayoutEffect(() => {
    if (!editing) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [editing]);

  // When a non-editing update arrives from elsewhere (undo, canvas-agent),
  // keep the DOM text in sync with the stored value.
  useEffect(() => {
    if (editing) return;
    const el = editorRef.current;
    if (el && el.innerText !== (data.text ?? '')) {
      el.innerText = data.text ?? '';
    }
  }, [data.text, editing]);

  // Leaving selection should exit edit mode — otherwise the node can get
  // stuck in an "editing but not selected" state that the user can't see.
  useEffect(() => {
    if (!readOnly && editing && !isSelected) commit();
  }, [editing, isSelected, commit, readOnly]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (readOnly) return;
      // Escape/Enter mid-IME-composition steer the candidate window —
      // cancelling or committing there would eat the half-typed CJK input.
      if (isImeComposing(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl+Enter commits; plain Enter inserts a newline.
        e.preventDefault();
        commit();
      }
    },
    [cancel, commit, readOnly],
  );

  const w = Math.max(1, node.width);
  const h = Math.max(1, node.height);
  const fontSize = data.fontSize ?? 16;
  const textColor =
    data.textColor ??
    (data.stroke && data.stroke !== 'transparent' ? data.stroke : '#1f2328');
  // Pad the text so it doesn't crowd the shape outline. Shapes with
  // curved or angled sides (ellipse, triangle, diamond, star) have a
  // smaller inscribed rectangle, so we pull the label in harder on them.
  const tightShapes: ShapeNodeData['kind'][] = ['ellipse', 'triangle', 'diamond', 'star'];
  const padRatio = tightShapes.includes(data.kind) ? 0.15 : 0.08;
  const padX = Math.max(8, Math.round(w * padRatio));
  const padY = Math.max(6, Math.round(h * padRatio));

  return (
    <div className="shape-node-body" onMouseDown={handleMouseDown} onDoubleClick={handleDoubleClick}>
      <svg
        className="shape-node-svg"
        width="100%"
        height="100%"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
      >
        <ShapePrimitive
          kind={data.kind}
          width={w}
          height={h}
          fill={data.fill}
          stroke={data.stroke}
          strokeWidth={data.strokeWidth ?? 0}
        />
      </svg>
      <div
        className={`shape-node-text-wrap${!data.text && !editing ? ' shape-node-text-wrap--empty' : ''}`}
        style={{
          paddingLeft: padX,
          paddingRight: padX,
          paddingTop: padY,
          paddingBottom: padY,
        }}
      >
        <div
          ref={editorRef}
          className={`shape-node-text${editing ? ' shape-node-text--editing' : ''}`}
          style={{ color: textColor, fontSize }}
          contentEditable={!readOnly && editing}
          suppressContentEditableWarning
          spellCheck={false}
          onMouseDown={(e) => {
            if (editing) e.stopPropagation();
          }}
          onBlur={commit}
          onKeyDown={handleKeyDown}
        >
          {data.text ?? ''}
        </div>
      </div>
    </div>
  );
};
