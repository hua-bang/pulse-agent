import type { RefObject } from 'react';
import { CloseIcon, PencilIcon, PlusIcon } from '../../../components/icons';
import { Button, Popover } from '../../../components/ui';
import { useI18n } from '../../../i18n';

interface FolderItemMenuProps {
  anchorRef: RefObject<HTMLButtonElement>;
  label: string;
  onClose: () => void;
  onCreateWorkspace: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/** The folder row's right-click menu: the same actions as its hover buttons. */
export const FolderItemMenu = ({
  anchorRef,
  label,
  onClose,
  onCreateWorkspace,
  onRename,
  onDelete,
}: FolderItemMenuProps) => {
  const { t } = useI18n();

  return (
    <Popover
      anchorRef={anchorRef}
      placement="bottom"
      align="start"
      gap={4}
      ariaLabel={label}
      className="sidebar-item-menu"
      onClose={onClose}
    >
      <Button size="sm" className="sidebar-item-menu-item" role="menuitem" onClick={onCreateWorkspace}>
        <PlusIcon size={13} strokeWidth={1.5} />
        <span>{t('sidebar.newWorkspaceInFolder')}</span>
      </Button>
      <Button size="sm" className="sidebar-item-menu-item" role="menuitem" onClick={onRename}>
        <PencilIcon size={13} strokeWidth={1.4} />
        <span>{t('sidebar.renameFolder')}</span>
      </Button>
      <div className="sidebar-item-menu-separator" />
      <Button
        size="sm"
        className="sidebar-item-menu-item sidebar-item-menu-item--danger"
        role="menuitem"
        onClick={onDelete}
      >
        <CloseIcon size={13} strokeWidth={1.5} />
        <span>{t('sidebar.deleteFolder')}</span>
      </Button>
    </Popover>
  );
};
