import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './index.css';
import type { Editor } from '@tiptap/react';
import type { NoteBubbleState } from '../../hooks/useNoteInteractionController';

interface Props {
  editor: Editor;
  bubble: NoteBubbleState;
  onOpenLinkPrompt: () => void;
}

const VIEWPORT_MARGIN_PX = 8;
const SELECTION_GAP_PX = 8;

export const FileNodeBubbleMenu = ({ editor, bubble, onOpenLinkPrompt }: Props) => {
  // The CSS default hangs the menu centered above the selection, which cuts
  // it off for selections near the top or side edges of the window. Measure
  // after layout, clamp horizontally, and flip below the selection when
  // there's no room above.
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number; flipped: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const halfW = w / 2;
    const left = Math.max(
      VIEWPORT_MARGIN_PX + halfW,
      Math.min(bubble.x, window.innerWidth - VIEWPORT_MARGIN_PX - halfW),
    );
    const flipped = bubble.y - h - SELECTION_GAP_PX < VIEWPORT_MARGIN_PX;
    setPlacement({ left, top: flipped ? bubble.bottom : bubble.y, flipped });
  }, [bubble.x, bubble.y, bubble.bottom]);

  return createPortal(
  <div
    ref={menuRef}
    className="note-bubble-menu"
    style={{
      left: placement?.left ?? bubble.x,
      top: placement?.top ?? bubble.y,
      // Above the selection by default; below it when clamped at the top.
      transform: placement?.flipped
        ? `translate(-50%, ${SELECTION_GAP_PX}px)`
        : `translate(-50%, calc(-100% - ${SELECTION_GAP_PX}px))`,
    }}
    onMouseDown={(e) => e.preventDefault()}
  >
    <button
      className={`note-bubble-btn ${editor.isActive('bold') ? 'note-bubble-btn--active' : ''}`}
      onClick={() => editor.chain().focus().toggleBold().run()}
      title="Bold"
    >
      <strong>B</strong>
    </button>
    <button
      className={`note-bubble-btn ${editor.isActive('italic') ? 'note-bubble-btn--active' : ''}`}
      onClick={() => editor.chain().focus().toggleItalic().run()}
      title="Italic"
    >
      <em>I</em>
    </button>
    <button
      className={`note-bubble-btn ${editor.isActive('underline') ? 'note-bubble-btn--active' : ''}`}
      onClick={() => editor.chain().focus().toggleUnderline().run()}
      title="Underline"
    >
      <span style={{ textDecoration: 'underline' }}>U</span>
    </button>
    <button
      className={`note-bubble-btn ${editor.isActive('strike') ? 'note-bubble-btn--active' : ''}`}
      onClick={() => editor.chain().focus().toggleStrike().run()}
      title="Strikethrough"
    >
      <span style={{ textDecoration: 'line-through' }}>S</span>
    </button>
    <button
      className={`note-bubble-btn ${editor.isActive('highlight') ? 'note-bubble-btn--active' : ''}`}
      onClick={() => editor.chain().focus().toggleHighlight().run()}
      title="Highlight"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path
          d="M3 11l6-6 3 3-6 6H3v-3z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
          fill="rgba(253, 224, 71, 0.6)"
        />
        <path d="M9 5l2-2 3 3-2 2" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </button>
    <button
      className={`note-bubble-btn ${editor.isActive('code') ? 'note-bubble-btn--active' : ''}`}
      onClick={() => editor.chain().focus().toggleCode().run()}
      title="Inline code"
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>`·`</span>
    </button>
    <button
      className={`note-bubble-btn ${editor.isActive('link') ? 'note-bubble-btn--active' : ''}`}
      onClick={onOpenLinkPrompt}
      title="Link"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path
          d="M7 9l2-2M6.5 5.5L8 4a2.5 2.5 0 113.5 3.5L10 9M9.5 10.5L8 12a2.5 2.5 0 11-3.5-3.5L6 7"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    </button>
    <div className="note-bubble-divider" />
    <button
      className={`note-bubble-btn ${editor.isActive('heading', { level: 1 }) ? 'note-bubble-btn--active' : ''}`}
      onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      title="Heading 1"
    >
      H1
    </button>
    <button
      className={`note-bubble-btn ${editor.isActive('heading', { level: 2 }) ? 'note-bubble-btn--active' : ''}`}
      onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      title="Heading 2"
    >
      H2
    </button>
    <button
      className={`note-bubble-btn ${editor.isActive('heading', { level: 3 }) ? 'note-bubble-btn--active' : ''}`}
      onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      title="Heading 3"
    >
      H3
    </button>
    <div className="note-bubble-divider" />
    <button
      className={`note-bubble-btn ${editor.isActive('bulletList') ? 'note-bubble-btn--active' : ''}`}
      onClick={() => editor.chain().focus().toggleBulletList().run()}
      title="Bullet list"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path
          d="M6 4h7M6 8h7M6 12h7"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="3" cy="4" r="1.1" fill="currentColor" />
        <circle cx="3" cy="8" r="1.1" fill="currentColor" />
        <circle cx="3" cy="12" r="1.1" fill="currentColor" />
      </svg>
    </button>
    <button
      className={`note-bubble-btn ${editor.isActive('blockquote') ? 'note-bubble-btn--active' : ''}`}
      onClick={() => editor.chain().focus().toggleBlockquote().run()}
      title="Blockquote"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path d="M3 3v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M6 5h7M6 8h5M6 11h6"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    </button>
  </div>,
  document.body,
  );
};
