import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { useI18n } from '../../i18n';
import { deleteNoteBlock, duplicateCurrentNoteBlock, moveCurrentNoteBlock, moveNoteBlockToIndex } from '../../editor/noteBlockCommands';
import { Button, Popover } from '../ui';
import './index.css';

interface BlockTarget {
  index: number;
  top: number;
  height: number;
}

interface Props {
  editor: Editor;
  cardRef: RefObject<HTMLDivElement>;
}

export const NoteBlockHandle = ({ editor, cardRef }: Props) => {
  const { t } = useI18n();
  const [active, setActive] = useState<BlockTarget | null>(null);
  const [dropTop, setDropTop] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const draggedIndexRef = useRef<number | null>(null);
  const didDragRef = useRef(false);
  const handleRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;

  useEffect(() => {
    const root = editor.view.dom;
    const card = cardRef.current;
    if (!card) return;

    const targetBlock = (target: EventTarget | null): { element: HTMLElement; target: BlockTarget } | null => {
      let element = target instanceof HTMLElement ? target : null;
      while (element && element.parentElement !== root) element = element.parentElement;
      if (!element || element.parentElement !== root) return null;
      const index = Array.from(root.children).indexOf(element);
      if (index < 0) return null;
      const rect = element.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      return { element, target: { index, top: rect.top - cardRect.top, height: rect.height } };
    };

    const onMouseMove = (event: MouseEvent) => {
      if (draggedIndexRef.current !== null || menuOpenRef.current) return;
      const hit = targetBlock(event.target);
      if (hit) setActive(hit.target);
    };
    const onMouseLeave = (event: MouseEvent) => {
      if (menuOpenRef.current || handleRef.current?.contains(event.relatedTarget as Node | null)) return;
      setActive(null);
    };
    const onDragOver = (event: DragEvent) => {
      if (draggedIndexRef.current === null) return;
      const hit = targetBlock(event.target);
      if (!hit) return;
      event.preventDefault();
      const rect = hit.element.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      const scroller = root.parentElement;
      if (scroller) {
        const scrollerRect = scroller.getBoundingClientRect();
        if (event.clientY < scrollerRect.top + 40) scroller.scrollBy({ top: -14 });
        if (event.clientY > scrollerRect.bottom - 40) scroller.scrollBy({ top: 14 });
      }
      setActive(hit.target);
      setDropTop(hit.target.top + (after ? hit.target.height : 0));
    };
    const onDrop = (event: DragEvent) => {
      const fromIndex = draggedIndexRef.current;
      const hit = targetBlock(event.target);
      if (fromIndex === null || !hit) return;
      event.preventDefault();
      const rect = hit.element.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      let finalIndex = hit.target.index + (after ? 1 : 0);
      if (fromIndex < finalIndex) finalIndex -= 1;
      moveNoteBlockToIndex(editor, fromIndex, finalIndex);
      draggedIndexRef.current = null;
      setDropTop(null);
    };

    root.addEventListener('mousemove', onMouseMove);
    root.addEventListener('mouseleave', onMouseLeave);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('drop', onDrop);
    const scroller = root.parentElement;
    const clearStaleTarget = () => {
      setActive(null);
      setDropTop(null);
      setMenuOpen(false);
    };
    scroller?.addEventListener('scroll', clearStaleTarget);
    editor.on('transaction', clearStaleTarget);
    return () => {
      root.removeEventListener('mousemove', onMouseMove);
      root.removeEventListener('mouseleave', onMouseLeave);
      root.removeEventListener('dragover', onDragOver);
      root.removeEventListener('drop', onDrop);
      scroller?.removeEventListener('scroll', clearStaleTarget);
      editor.off('transaction', clearStaleTarget);
    };
  }, [cardRef, editor]);

  const run = (action: (index: number) => unknown) => {
    if (active) action(active.index);
    setMenuOpen(false);
  };

  if (!active) return null;
  return (
    <>
      <span
        ref={handleRef}
        className="note-block-handle-anchor"
        style={{ top: active.top }}
        onMouseEnter={() => setActive(active)}
      >
        <Button
          variant="icon"
          size="sm"
          className="note-block-handle"
          draggable
          aria-label={t('noteBlock.actions')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? panelId : undefined}
          onClick={() => {
            if (didDragRef.current) {
              didDragRef.current = false;
              return;
            }
            setMenuOpen((value) => !value);
          }}
          onDragStart={(event) => {
            draggedIndexRef.current = active.index;
            didDragRef.current = true;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-pulse-note-block', String(active.index));
          }}
          onDragEnd={() => {
            draggedIndexRef.current = null;
            setDropTop(null);
            setTimeout(() => { didDragRef.current = false; }, 0);
          }}
        >
          <span aria-hidden="true">⠿</span>
        </Button>
        {menuOpen && (
          <Popover
            anchorRef={handleRef}
            placement="bottom"
            align="start"
            gap={4}
            onClose={() => setMenuOpen(false)}
            className="note-block-menu"
            ariaLabel={t('noteBlock.actions')}
            panelId={panelId}
          >
            <Button size="sm" className="note-block-menu__item" role="menuitem" onClick={() => run((index) => moveCurrentNoteBlock(editor, -1, index))}>{t('noteToolbar.moveBlockUp')}</Button>
            <Button size="sm" className="note-block-menu__item" role="menuitem" onClick={() => run((index) => moveCurrentNoteBlock(editor, 1, index))}>{t('noteToolbar.moveBlockDown')}</Button>
            <Button size="sm" className="note-block-menu__item" role="menuitem" onClick={() => run((index) => duplicateCurrentNoteBlock(editor, index))}>{t('noteToolbar.duplicateBlock')}</Button>
            <div className="note-block-menu__separator" />
            <Button size="sm" variant="danger" className="note-block-menu__item note-block-menu__item--danger" role="menuitem" onClick={() => run((index) => deleteNoteBlock(editor, index))}>{t('noteBlock.delete')}</Button>
          </Popover>
        )}
      </span>
      {dropTop !== null && <span className="note-block-drop-line" style={{ top: dropTop }} aria-hidden="true" />}
    </>
  );
};
