import {
  useEffect,
  useId,
  type ChangeEventHandler,
  type MouseEventHandler,
  type RefObject,
} from 'react';
import { EditorContent, type Editor } from '@tiptap/react';
import type { SlashCmd } from '../../editor/slashCommands';
import { filterCmds } from '../../editor/slashCommands';
import { insertSlashBlockAfter } from '../../editor/noteBlockCommands';
import type { NoteInteractionController } from '../../hooks/useNoteInteractionController';
import type { CanvasNode } from '../../types';
import { FileNodeBubbleMenu } from '../FileNodeBubbleMenu';
import { NoteBlockHandle } from '../NoteBlockHandle';
import { NoteFindBar } from '../NoteFindBar';
import { NoteLinkPrompt } from '../NoteLinkPrompt';
import { NoteMentionMenu } from '../NoteMentionMenu';
import { NoteOutline } from '../NoteOutline';
import { SlashCommandMenu } from '../SlashCommandMenu';

interface Props {
  editor: Editor | null;
  readOnly: boolean;
  cardRef: RefObject<HTMLDivElement>;
  interactions: NoteInteractionController;
  handleSlashSelect: (command: SlashCmd) => void;
  openLinkPrompt: () => void;
  applyLink: (url: string) => void;
  cancelLink: () => void;
  imageInputRef: RefObject<HTMLInputElement>;
  onImageInputChange: ChangeEventHandler<HTMLInputElement>;
  onLinkClickCapture: MouseEventHandler<HTMLDivElement>;
  filteredMentions: CanvasNode[];
  insertMention: (node: CanvasNode) => void;
  closeMention: () => void;
}

export const FileNodeEditorSurface = ({
  editor,
  readOnly,
  cardRef,
  interactions,
  handleSlashSelect,
  openLinkPrompt,
  applyLink,
  cancelLink,
  imageInputRef,
  onImageInputChange,
  onLinkClickCapture,
  filteredMentions,
  insertMention,
  closeMention,
}: Props) => {
  const slashPanelId = useId();
  const {
    slashMenu,
    mentionMenu,
    bubble,
    linkPrompt,
    findBarOpen,
    outlineOpen,
    openSlashMenu,
    closeSlashMenu,
    closeFindBar,
    closeOutline,
  } = interactions;
  const slashItems = slashMenu ? filterCmds(slashMenu.query) : [];
  const activeSlashItem = slashMenu
    ? slashItems[Math.min(slashMenu.index, slashItems.length - 1)]
    : undefined;

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    if (slashMenu) {
      dom.setAttribute('aria-haspopup', 'listbox');
      dom.setAttribute('aria-controls', slashPanelId);
      dom.setAttribute('aria-expanded', 'true');
      if (activeSlashItem) {
        dom.setAttribute(
          'aria-activedescendant',
          `${slashPanelId}-${activeSlashItem.id}`,
        );
      } else {
        dom.removeAttribute('aria-activedescendant');
      }
    } else {
      dom.removeAttribute('aria-haspopup');
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-expanded');
      dom.removeAttribute('aria-activedescendant');
    }

    return () => {
      dom.removeAttribute('aria-haspopup');
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-expanded');
      dom.removeAttribute('aria-activedescendant');
    };
  }, [activeSlashItem, editor, slashMenu, slashPanelId]);

  return (
    <>
      {!readOnly && findBarOpen && editor && (
        <NoteFindBar editor={editor} onClose={closeFindBar} />
      )}

      {!readOnly && outlineOpen && editor && (
        <NoteOutline editor={editor} onClose={closeOutline} />
      )}

      {!readOnly && linkPrompt && (
        <NoteLinkPrompt
          initial={linkPrompt.initial}
          onApply={applyLink}
          onCancel={cancelLink}
        />
      )}

      {!readOnly && bubble && editor && (
        <FileNodeBubbleMenu
          editor={editor}
          bubble={bubble}
          onOpenLinkPrompt={openLinkPrompt}
        />
      )}

      <div
        className="note-content"
        onPaste={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onClickCapture={onLinkClickCapture}
      >
        <EditorContent editor={editor} className="note-tiptap-editor" />
      </div>

      {!readOnly && editor && (
        <NoteBlockHandle
          editor={editor}
          cardRef={cardRef}
          onAddBlock={(index) => {
            if (!insertSlashBlockAfter(editor, index)) return;
            const slashFrom = editor.state.selection.from - 1;
            const coords = editor.view.coordsAtPos(slashFrom);
            openSlashMenu({
              x: coords.left,
              y: coords.bottom,
              query: '',
              index: 0,
              slashFrom,
            });
          }}
        />
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onImageInputChange}
      />

      {!readOnly && slashMenu && (
        <SlashCommandMenu
          panelId={slashPanelId}
          x={slashMenu.x}
          y={slashMenu.y}
          query={slashMenu.query}
          selectedIndex={slashMenu.index}
          items={slashItems}
          onSelect={handleSlashSelect}
          onClose={closeSlashMenu}
        />
      )}

      {!readOnly && mentionMenu && (
        <NoteMentionMenu
          x={mentionMenu.x}
          y={mentionMenu.y}
          items={filteredMentions}
          selectedIndex={mentionMenu.index}
          onSelect={insertMention}
          onClose={closeMention}
        />
      )}
    </>
  );
};
