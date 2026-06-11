import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import type { LaidOutTopic } from '../../utils/mindmapLayout';
import type { DropHint, KeyAction } from './types';
import { isImeComposing } from '../../utils/ime';

interface TopicPillProps {
  topic: LaidOutTopic;
  isSelected: boolean;
  isEditing: boolean;
  outerCanvasSelected: boolean;
  isDragSource: boolean;
  dropHint: DropHint;
  onBeginReorder: (e: MouseEvent) => void;
  onSelect: () => void;
  onEnterEdit: () => void;
  onCommitText: (text: string) => void;
  onToggleCollapsed: () => void;
  onKeyAction: (action: KeyAction) => void;
  readOnly?: boolean;
}

export const TopicPill = ({
  topic,
  isSelected,
  isEditing,
  outerCanvasSelected,
  isDragSource,
  dropHint,
  onBeginReorder,
  onSelect,
  onEnterEdit,
  onCommitText,
  onToggleCollapsed,
  onKeyAction,
  readOnly = false,
}: TopicPillProps) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (readOnly || !isEditing) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [isEditing, readOnly]);

  useEffect(() => {
    if (isEditing || readOnly) return;
    if (isSelected && outerCanvasSelected) pillRef.current?.focus();
  }, [isSelected, outerCanvasSelected, isEditing, readOnly]);

  useEffect(() => {
    if (isEditing) return;
    const el = editorRef.current;
    if (el && el.innerText !== topic.text) el.innerText = topic.text;
  }, [topic.text, isEditing]);

  const commit = useCallback(() => {
    if (readOnly) return;
    const el = editorRef.current;
    const next = el ? el.innerText.replace(/\n+$/, '') : topic.text;
    if (next !== topic.text) onCommitText(next);
  }, [onCommitText, topic.text, readOnly]);

  const cancel = useCallback(() => {
    const el = editorRef.current;
    if (el) el.innerText = topic.text;
  }, [topic.text]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (readOnly) return;
      // Mid-IME-composition keys (Enter to confirm a candidate, Escape to
      // dismiss it) belong to the IME — committing/cancelling the topic
      // here would eat CJK input.
      if (isImeComposing(e)) return;
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (isEditing) {
        if (e.key === 'Escape') {
          consume();
          cancel();
          onKeyAction({ kind: 'exit' });
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          consume();
          commit();
          onKeyAction({ kind: 'exit' });
          return;
        }
        if (e.key === 'Tab') {
          consume();
          const el = editorRef.current;
          const pendingText = el ? el.innerText.replace(/\n+$/, '') : topic.text;
          if (e.shiftKey) onKeyAction({ kind: 'unindent', pendingText });
          else onKeyAction({ kind: 'addChild', pendingText });
        }
        return;
      }

      switch (e.key) {
        case 'Enter':
          consume();
          onKeyAction({ kind: 'addSibling' });
          return;
        case 'Tab':
          consume();
          if (e.shiftKey) onKeyAction({ kind: 'unindent' });
          else onKeyAction({ kind: 'addChild' });
          return;
        case 'Backspace':
        case 'Delete':
          consume();
          onKeyAction({ kind: 'delete' });
          return;
        case ' ':
          if (topic.hasChildren) {
            consume();
            onKeyAction({ kind: 'toggle' });
          }
          return;
        case 'ArrowUp':
          consume();
          onKeyAction({ kind: 'move', dir: 'up' });
          return;
        case 'ArrowDown':
          consume();
          onKeyAction({ kind: 'move', dir: 'down' });
          return;
        case 'ArrowLeft':
          consume();
          onKeyAction({ kind: 'move', dir: 'left' });
          return;
        case 'ArrowRight':
          consume();
          onKeyAction({ kind: 'move', dir: 'right' });
          return;
        case 'F2':
        case 'Escape':
          consume();
          if (e.key === 'F2') onEnterEdit();
          else onKeyAction({ kind: 'exit' });
          return;
        default:
          if (
            e.key.length === 1
            && !e.metaKey
            && !e.ctrlKey
            && !e.altKey
            && e.key.toLowerCase() !== 'f'
          ) {
            onEnterEdit();
          }
      }
    },
    [cancel, commit, isEditing, onEnterEdit, onKeyAction, topic.hasChildren, topic.text, readOnly],
  );

  const isRoot = topic.depth === 0;
  const style: CSSProperties = {
    transform: `translate(${topic.x}px, ${topic.y}px)`,
    width: topic.width,
    minHeight: topic.height,
    color: '#1f2328',
    ['--mindmap-topic-accent' as string]: topic.color,
  };
  const isEmpty = !topic.text;

  return (
    <div
      ref={pillRef}
      data-topic-id={topic.id}
      className={[
        'mindmap-topic',
        isRoot && 'mindmap-topic--root',
        isSelected && 'mindmap-topic--selected',
        isEditing && 'mindmap-topic--editing',
        topic.collapsed && 'mindmap-topic--collapsed',
        isDragSource && 'mindmap-topic--drag-source',
        dropHint === 'before' && 'mindmap-topic--drop-before',
        dropHint === 'after' && 'mindmap-topic--drop-after',
        dropHint === 'child' && 'mindmap-topic--drop-child',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      tabIndex={readOnly ? undefined : 0}
      onMouseDown={(e) => {
        if (readOnly) {
          e.stopPropagation();
          return;
        }
        const handToolActive = e.currentTarget.closest('.canvas-container--hand') != null;
        const isPanGesture = e.button === 1 || (e.button === 0 && (e.altKey || handToolActive));
        if (isPanGesture) return;
        e.stopPropagation();
        onSelect();
        if (e.button === 0 && !isEditing) onBeginReorder(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!readOnly) onEnterEdit();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={editorRef}
        className={[
          'mindmap-topic-text',
          isEmpty && !isEditing && 'mindmap-topic-text--empty',
        ]
          .filter(Boolean)
          .join(' ')}
        contentEditable={!readOnly && isEditing}
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder="Untitled"
        onBlur={() => {
          if (isEditing && !readOnly) {
            commit();
            onKeyAction({ kind: 'exit' });
          }
        }}
      >
        {topic.text}
      </div>
      {!readOnly && !isRoot && topic.hasChildren && (
        <button
          type="button"
          className={[
            'mindmap-topic-toggle',
            topic.collapsed && 'mindmap-topic-toggle--collapsed',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ ['--mindmap-topic-toggle-color' as string]: topic.color }}
          aria-label={topic.collapsed ? 'Expand subtree' : 'Collapse subtree'}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapsed();
          }}
        />
      )}
    </div>
  );
};
