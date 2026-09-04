import {
  useEffect,
  useId,
  type ChangeEventHandler,
  type MouseEventHandler,
  type RefObject,
} from 'react';
import { EditorContent, type Editor } from '@tiptap/react';
import type { SlashCmd } from '../../runtime/slashCommands';
import { filterCmds } from '../../runtime/slashCommands';
import { insertSlashBlockAfter } from '../../runtime/noteBlockCommands';
import type { NoteInteractionController } from '../../controller/useNoteInteractionController';
import type { CanvasNode } from '../../../../types';
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
  const mentionPanelId = useId();
  const {
    slashMenu,
    mentionMenu,
    bubble,
    linkPrompt,
    findBarOpen,
    outlineOpen,
    openSlashMenu,
    closeSlashMenu,
    closeBubble,
    closeFindBar,
    closeOutline,
  } = interactions;
  const slashItems = slashMenu ? filterCmds(slashMenu.query) : [];
  const activeSlashItem = slashMenu
    ? slashItems[Math.min(slashMenu.index, slashItems.length - 1)]
    : undefined;
  const activeMention = mentionMenu
    ? filteredMentions[Math.min(mentionMenu.index, filteredMentions.length - 1)]
    : undefined;

  useEffect(() => {
    if (!editor) return;
    let mountedDom: HTMLElement | null = null;
    const clearAria = () => {
      mountedDom?.removeAttribute('aria-haspopup');
      mountedDom?.removeAttribute('aria-controls');
      mountedDom?.removeAttribute('aria-expanded');
      mountedDom?.removeAttribute('aria-activedescendant');
    };
    const getMountedDom = () => {
      try {
        return editor.view.dom;
      } catch (error) {
        if (
          error instanceof Error
          && error.message.includes('editor view is not available')
        ) {
          return null;
        }
        throw error;
      }
    };
    const syncAria = () => {
      // `useEditor` creates the Editor before EditorContent mounts its view.
      // Accessing editor.view during that gap throws and used to blank the
      // whole canvas when several lazy file cards initialized together.
      mountedDom = getMountedDom();
      if (!mountedDom) return;
      if (slashMenu) {
        mountedDom.setAttribute('aria-haspopup', 'listbox');
        mountedDom.setAttribute('aria-controls', slashPanelId);
        mountedDom.setAttribute('aria-expanded', 'true');
        if (activeSlashItem) {
          mountedDom.setAttribute(
            'aria-activedescendant',
            `${slashPanelId}-${activeSlashItem.id}`,
          );
        } else {
          mountedDom.removeAttribute('aria-activedescendant');
        }
      } else if (mentionMenu && filteredMentions.length > 0) {
        mountedDom.setAttribute('aria-haspopup', 'listbox');
        mountedDom.setAttribute('aria-controls', mentionPanelId);
        mountedDom.setAttribute('aria-expanded', 'true');
        if (activeMention) {
          mountedDom.setAttribute(
            'aria-activedescendant',
            `${mentionPanelId}-${activeMention.id}`,
          );
        } else {
          mountedDom.removeAttribute('aria-activedescendant');
        }
      } else {
        clearAria();
      }
    };
    const handleUnmount = () => {
      clearAria();
      mountedDom = null;
    };

    editor.on('mount', syncAria);
    editor.on('unmount', handleUnmount);
    syncAria();
    return () => {
      editor.off('mount', syncAria);
      editor.off('unmount', handleUnmount);
      clearAria();
    };
  }, [
    activeMention,
    activeSlashItem,
    editor,
    filteredMentions.length,
    mentionMenu,
    mentionPanelId,
    slashMenu,
    slashPanelId,
  ]);

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
          onClose={closeBubble}
        />
      )}

      <div
        className="note-content"
        onPaste={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onScrollCapture={() => {
          // Slash, mention, and selection surfaces use one-shot viewport
          // coordinates. Once the editor's own scroller moves, dismiss them
          // together instead of leaving detached UI over unrelated content.
          // Guard the setters so ordinary document scrolling stays on the
          // browser's hot path after the one open surface has been closed.
          if (bubble) closeBubble();
          if (slashMenu) closeSlashMenu();
          if (mentionMenu) closeMention();
        }}
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
          panelId={mentionPanelId}
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
