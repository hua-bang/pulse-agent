import {
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  CaretDown,
  Code,
  HighlighterCircle,
  LinkSimple,
  TextB,
  TextItalic,
  TextStrikethrough,
  TextUnderline,
} from '@phosphor-icons/react';
import type { Editor } from '@tiptap/react';
import { ALL_SLASH_COMMANDS, type SlashCmd } from '../../runtime/slashCommands';
import type { NoteBubbleState } from '../../controller/useNoteInteractionController';
import { subscribeCanvasMotion } from '../../../../hooks/canvasMotion';
import { useEscapeClose } from '../../../../hooks/useEscapeClose';
import { useI18n } from '../../../../i18n';
import { EditorCommandIcon } from '../EditorCommandIcon';
import { Button, Popover, Portal } from '../../../../components/ui';
import './index.css';

interface Props {
  editor: Editor;
  bubble: NoteBubbleState;
  onOpenLinkPrompt: () => void;
  onClose: () => void;
}

const VIEWPORT_MARGIN_PX = 8;
const SELECTION_GAP_PX = 8;
const BLOCK_TYPE_COMMANDS = ALL_SLASH_COMMANDS.filter(
  (command): command is SlashCmd & Required<Pick<SlashCmd, 'isBlockTypeActive'>> =>
    Boolean(command.isBlockTypeActive),
);

export const FileNodeBubbleMenu = ({
  editor,
  bubble,
  onOpenLinkPrompt,
  onClose,
}: Props) => {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const typeButtonRef = useRef<HTMLButtonElement>(null);
  const typePanelId = useId();
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [, renderTransaction] = useReducer((value: number) => value + 1, 0);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    flipped: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const halfWidth = width / 2;
    const left = Math.max(
      VIEWPORT_MARGIN_PX + halfWidth,
      Math.min(bubble.x, window.innerWidth - VIEWPORT_MARGIN_PX - halfWidth),
    );
    const flipped = bubble.y - height - SELECTION_GAP_PX < VIEWPORT_MARGIN_PX;
    setPlacement({ left, top: flipped ? bubble.bottom : bubble.y, flipped });
  }, [bubble.bottom, bubble.x, bubble.y]);

  useEffect(() => subscribeCanvasMotion((motion) => {
    if (motion.mode !== 'idle') onClose();
  }), [onClose]);

  useEffect(() => {
    const handleTransaction = () => renderTransaction();
    editor.on('transaction', handleTransaction);
    return () => {
      editor.off('transaction', handleTransaction);
    };
  }, [editor]);

  // The nested block-type Popover owns Escape while it is open. Otherwise
  // the selection toolbar consumes Escape itself so the same key press does
  // not also reach canvas-level deselection/dismiss handlers.
  useEscapeClose(!typeMenuOpen, onClose);

  const currentBlockType = BLOCK_TYPE_COMMANDS.find((command) =>
    command.isBlockTypeActive(editor),
  ) ?? BLOCK_TYPE_COMMANDS[0];

  const runBlockType = (command: SlashCmd) => {
    const { from } = editor.state.selection;
    command.run(editor, from, from);
    setTypeMenuOpen(false);
  };

  const iconButton = (
    label: string,
    active: boolean,
    onClick: () => void,
    icon: ReactNode,
  ) => (
    <Button
      variant="icon"
      size="sm"
      className={`note-bubble-btn${active ? ' note-bubble-btn--active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      {icon}
    </Button>
  );

  return (
    <Portal>
      <div
        ref={menuRef}
        className="note-bubble-menu"
        role="toolbar"
        aria-label={t('noteBubble.label')}
        style={{
          left: placement?.left ?? bubble.x,
          top: placement?.top ?? bubble.y,
          transform: placement?.flipped
            ? `translate(-50%, ${SELECTION_GAP_PX}px)`
            : `translate(-50%, calc(-100% - ${SELECTION_GAP_PX}px))`,
        }}
        onMouseDown={(event) => event.preventDefault()}
        onWheel={(event) => {
          // This toolbar is portaled to document.body, but React events still
          // bubble through its canvas-side component ancestry. Keep trackpad
          // input inside the toolbar from starting a canvas pan/zoom gesture.
          event.stopPropagation();
        }}
      >
        <Button
          ref={typeButtonRef}
          size="sm"
          className="note-bubble-type"
          aria-label={t('noteBubble.blockType')}
          aria-haspopup="menu"
          aria-expanded={typeMenuOpen}
          aria-controls={typeMenuOpen ? typePanelId : undefined}
          onClick={() => setTypeMenuOpen((open) => !open)}
        >
          {currentBlockType && <EditorCommandIcon icon={currentBlockType.icon} size={16} />}
          <span>{currentBlockType ? t(currentBlockType.labelKey) : t('slashCommand.text.label')}</span>
          <CaretDown size={11} weight="bold" aria-hidden="true" />
        </Button>

        {typeMenuOpen && (
          <Popover
            anchorRef={typeButtonRef}
            placement="bottom"
            align="start"
            gap={6}
            className="note-bubble-type-menu"
            ariaLabel={t('noteBubble.blockType')}
            panelId={typePanelId}
            autoFocus={false}
            closeOnCanvasMotion
            onClose={(reason) => {
              setTypeMenuOpen(false);
              if (reason === 'escape') {
                requestAnimationFrame(() => editor.commands.focus());
              }
            }}
          >
            {BLOCK_TYPE_COMMANDS.map((command) => {
              const active = command.isBlockTypeActive(editor);
              return (
                <Button
                  key={command.id}
                  size="sm"
                  className={`note-bubble-type-item${
                    active ? ' note-bubble-type-item--active' : ''
                  }`}
                  role="menuitemradio"
                  aria-checked={active}
                  data-menu-autofocus={active ? 'true' : undefined}
                  onClick={() => runBlockType(command)}
                >
                  <EditorCommandIcon icon={command.icon} size={16} />
                  <span>{t(command.labelKey)}</span>
                </Button>
              );
            })}
          </Popover>
        )}

        <div className="note-bubble-divider" />
        {iconButton(
          t('noteBubble.bold'),
          editor.isActive('bold'),
          () => editor.chain().focus().toggleBold().run(),
          <TextB size={16} weight="bold" aria-hidden="true" />,
        )}
        {iconButton(
          t('noteBubble.italic'),
          editor.isActive('italic'),
          () => editor.chain().focus().toggleItalic().run(),
          <TextItalic size={16} aria-hidden="true" />,
        )}
        {iconButton(
          t('noteBubble.underline'),
          editor.isActive('underline'),
          () => editor.chain().focus().toggleUnderline().run(),
          <TextUnderline size={16} aria-hidden="true" />,
        )}
        {iconButton(
          t('noteBubble.strike'),
          editor.isActive('strike'),
          () => editor.chain().focus().toggleStrike().run(),
          <TextStrikethrough size={16} aria-hidden="true" />,
        )}
        {iconButton(
          t('noteBubble.highlight'),
          editor.isActive('highlight'),
          () => editor.chain().focus().toggleHighlight().run(),
          <HighlighterCircle size={16} aria-hidden="true" />,
        )}
        {iconButton(
          t('noteBubble.code'),
          editor.isActive('code'),
          () => editor.chain().focus().toggleCode().run(),
          <Code size={16} aria-hidden="true" />,
        )}
        {iconButton(
          t('noteBubble.link'),
          editor.isActive('link'),
          onOpenLinkPrompt,
          <LinkSimple size={16} aria-hidden="true" />,
        )}
      </div>
    </Portal>
  );
};
