import { useEffect, useState } from 'react';
import './index.css';
import type { Editor } from '@tiptap/react';

interface HeadingItem {
  pos: number;
  level: number;
  text: string;
}

const computeHeadings = (editor: Editor): HeadingItem[] => {
  const out: HeadingItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      out.push({ pos, level: (node.attrs.level as number) ?? 1, text: node.textContent.trim() });
    }
  });
  return out;
};

/** The heading whose section currently contains the caret — the last heading
 *  at or before the selection. */
const activeHeadingPos = (headings: HeadingItem[], from: number): number | null => {
  let active: number | null = null;
  for (const h of headings) {
    if (h.pos <= from) active = h.pos;
    else break;
  }
  return active;
};

interface Props {
  editor: Editor;
  onClose: () => void;
}

export const NoteOutline = ({ editor, onClose }: Props) => {
  const [headings, setHeadings] = useState<HeadingItem[]>(() => computeHeadings(editor));
  const [activePos, setActivePos] = useState<number | null>(null);

  useEffect(() => {
    const recompute = () => {
      const next = computeHeadings(editor);
      setHeadings(next);
      setActivePos(activeHeadingPos(next, editor.state.selection.from));
    };
    const trackActive = () => {
      setActivePos(activeHeadingPos(computeHeadings(editor), editor.state.selection.from));
    };
    recompute();
    editor.on('update', recompute);
    editor.on('selectionUpdate', trackActive);
    return () => {
      editor.off('update', recompute);
      editor.off('selectionUpdate', trackActive);
    };
  }, [editor]);

  const goTo = (pos: number) => {
    editor.chain().focus().setTextSelection(pos + 1).run();
    try {
      const coords = editor.view.coordsAtPos(pos + 1);
      const container = editor.view.dom.closest<HTMLElement>('.note-tiptap-editor');
      if (container) {
        const rect = container.getBoundingClientRect();
        container.scrollTop += coords.top - rect.top - 16;
      }
    } catch {
      // ignore pos resolution errors (doc changed underneath us)
    }
  };

  return (
    <div className="note-outline" onMouseDown={(e) => e.stopPropagation()}>
      <div className="note-outline-head">
        <span className="note-outline-title">Outline</span>
        <button
          className="note-outline-close"
          onClick={onClose}
          title="Close outline"
          aria-label="Close outline"
        >
          ×
        </button>
      </div>
      {headings.length === 0 ? (
        <div className="note-outline-empty">No headings yet</div>
      ) : (
        <ul className="note-outline-list">
          {headings.map((h, i) => (
            <li key={`${h.pos}-${i}`}>
              <button
                type="button"
                className={`note-outline-item note-outline-item--h${h.level}${
                  h.pos === activePos ? ' note-outline-item--active' : ''
                }`}
                onClick={() => goTo(h.pos)}
                title={h.text || 'Untitled'}
              >
                {h.text || 'Untitled'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
