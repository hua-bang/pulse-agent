import { useId, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  DotsThree,
  DownloadSimple,
  FloppyDisk,
  FolderOpen,
  ImageSquare,
  List,
  MagnifyingGlass,
  Trash,
} from '@phosphor-icons/react';
import { Button, Popover } from '../ui';
import { useI18n } from '../../i18n';
import { formatShortcut } from '../../utils/keyboardShortcut';
import './index.css';

interface Props {
  onOpenFile: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onInsertImage: () => void;
  onOpenFind: () => void;
  onToggleOutline: () => void;
  onMoveBlockUp: () => void;
  onMoveBlockDown: () => void;
  onDuplicateBlock: () => void;
  onDeleteBlock: () => void;
  outlineOpen: boolean;
  statusText: string;
  statusTone?: 'saving' | 'saved' | 'error';
  modified: boolean;
  fileName?: string | null;
  filePath?: string;
}

export const FileNodeToolbar = ({
  onOpenFile,
  onSave,
  onSaveAs,
  onInsertImage,
  onOpenFind,
  onToggleOutline,
  onMoveBlockUp,
  onMoveBlockDown,
  onDuplicateBlock,
  onDeleteBlock,
  outlineOpen,
  statusText,
  statusTone = 'saved',
  modified,
  fileName,
  filePath,
}: Props) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="note-toolbar" data-open={open}>
      <div
        className="note-toolbar-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-active={Boolean(statusText || modified)}
      >
        {statusText ? (
          <span className={`note-status note-status--${statusTone}`}>{statusText}</span>
        ) : modified ? (
          <span className="note-status note-status--modified">{t('noteToolbar.edited')}</span>
        ) : fileName ? (
          <span className="note-file-hint-inline" title={filePath}>{fileName}</span>
        ) : null}
      </div>
      <span ref={anchorRef} className="note-toolbar-menu-anchor">
        <Button
          variant="icon"
          size="sm"
          className="note-toolbar-more"
          aria-label={t('noteToolbar.actions')}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          <DotsThree size={18} weight="bold" aria-hidden="true" />
        </Button>
        {open && (
          <Popover
            anchorRef={anchorRef}
            placement="bottom"
            align="end"
            gap={5}
            onClose={() => setOpen(false)}
            className="note-toolbar-menu"
            ariaLabel={t('noteToolbar.actions')}
            panelId={panelId}
          >
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onOpenFind)}>
              <MagnifyingGlass size={16} aria-hidden="true" />
              <span>{t('noteToolbar.find')}</span>
              <kbd>{formatShortcut({ mod: true, key: 'F' })}</kbd>
            </Button>
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" aria-pressed={outlineOpen} onClick={() => run(onToggleOutline)}>
              <List size={16} aria-hidden="true" />
              <span>{t(outlineOpen ? 'noteToolbar.hideOutline' : 'noteToolbar.showOutline')}</span>
            </Button>
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onInsertImage)}>
              <ImageSquare size={16} aria-hidden="true" />
              <span>{t('noteToolbar.insertImage')}</span>
            </Button>
            <div className="note-toolbar-menu-separator" />
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onMoveBlockUp)}>
              <ArrowUp size={16} aria-hidden="true" />
              <span>{t('noteToolbar.moveBlockUp')}</span>
              <kbd>{formatShortcut({ alt: true, shift: true, key: '↑' })}</kbd>
            </Button>
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onMoveBlockDown)}>
              <ArrowDown size={16} aria-hidden="true" />
              <span>{t('noteToolbar.moveBlockDown')}</span>
              <kbd>{formatShortcut({ alt: true, shift: true, key: '↓' })}</kbd>
            </Button>
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onDuplicateBlock)}>
              <Copy size={16} aria-hidden="true" />
              <span>{t('noteToolbar.duplicateBlock')}</span>
              <kbd>{formatShortcut({ mod: true, shift: true, key: 'D' })}</kbd>
            </Button>
            <Button size="sm" variant="danger" className="note-toolbar-menu-item note-toolbar-menu-item--danger" role="menuitem" onClick={() => run(onDeleteBlock)}>
              <Trash size={16} aria-hidden="true" />
              <span>{t('noteBlock.delete')}</span>
            </Button>
            <div className="note-toolbar-menu-separator" />
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onOpenFile)}>
              <FolderOpen size={16} aria-hidden="true" />
              <span>{t('noteToolbar.openFile')}</span>
            </Button>
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onSave)}>
              <FloppyDisk size={16} aria-hidden="true" />
              <span>{t('noteToolbar.save')}</span>
              <kbd>{formatShortcut({ mod: true, key: 'S' })}</kbd>
            </Button>
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onSaveAs)}>
              <DownloadSimple size={16} aria-hidden="true" />
              <span>{t('noteToolbar.saveAs')}</span>
            </Button>
          </Popover>
        )}
      </span>
    </div>
  );
};
