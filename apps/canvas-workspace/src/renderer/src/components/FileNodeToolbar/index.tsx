import { useId, useRef, useState } from 'react';
import { Button, Popover } from '../ui';
import { useI18n } from '../../i18n';
import './index.css';

interface Props {
  onOpenFile: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onInsertImage: () => void;
  onOpenFind: () => void;
  onToggleOutline: () => void;
  outlineOpen: boolean;
  statusText: string;
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
  outlineOpen,
  statusText,
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
      <div className="note-toolbar-status">
        {statusText ? (
          <span className="note-status">{statusText}</span>
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
          <span aria-hidden="true">•••</span>
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
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onOpenFind)}>{t('noteToolbar.find')}</Button>
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" aria-pressed={outlineOpen} onClick={() => run(onToggleOutline)}>{t(outlineOpen ? 'noteToolbar.hideOutline' : 'noteToolbar.showOutline')}</Button>
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onInsertImage)}>{t('noteToolbar.insertImage')}</Button>
            <div className="note-toolbar-menu-separator" />
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onOpenFile)}>{t('noteToolbar.openFile')}</Button>
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onSave)}>{t('noteToolbar.save')}</Button>
            <Button size="sm" className="note-toolbar-menu-item" role="menuitem" onClick={() => run(onSaveAs)}>{t('noteToolbar.saveAs')}</Button>
          </Popover>
        )}
      </span>
    </div>
  );
};
