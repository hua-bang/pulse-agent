import type React from 'react';
import { FolderIcon, WorkspaceIcon } from '../icons';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';

interface InlineCreateRowProps {
  type: 'workspace' | 'folder';
  value: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export const InlineCreateRow = ({
  type,
  value,
  inputRef,
  onChange,
  onCommit,
  onCancel,
}: InlineCreateRowProps) => {
  const { t } = useI18n();

  return (
    <div className="sidebar-list">
      <div className="sidebar-inline-create">
        <span className="sidebar-item-icon">
          {type === 'folder' ? <FolderIcon size={14} /> : <WorkspaceIcon size={14} />}
        </span>
        <input
          ref={inputRef}
          className="sidebar-rename-input sidebar-rename-input--new"
          placeholder={type === 'folder' ? t('sidebar.folderNamePlaceholder') : t('sidebar.workspaceNamePlaceholder')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => (value.trim() ? onCommit() : onCancel())}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter') onCommit();
            if (e.key === 'Escape') onCancel();
          }}
        />
      </div>
    </div>
  );
};
