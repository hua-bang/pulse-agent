import type { RefObject } from 'react';
import { ExportIcon, PencilIcon, SettingsIcon, TrashIcon } from '../../../components/icons';
import { Button, Popover } from '../../../components/ui';
import { useI18n } from '../../../i18n';

interface WorkspaceItemMenuProps {
  anchorRef: RefObject<HTMLButtonElement>;
  label: string;
  canDelete: boolean;
  onClose: () => void;
  onRename: () => void;
  onOpenSettings: () => void;
  onExport: () => void;
  onDelete: () => void;
}

/** The workspace row's "more" menu: rename, settings, export, delete. */
export const WorkspaceItemMenu = ({
  anchorRef,
  label,
  canDelete,
  onClose,
  onRename,
  onOpenSettings,
  onExport,
  onDelete,
}: WorkspaceItemMenuProps) => {
  const { t } = useI18n();

  return (
    <Popover
      anchorRef={anchorRef}
      placement="bottom"
      align="end"
      gap={4}
      ariaLabel={label}
      className="sidebar-item-menu"
      onClose={onClose}
    >
      <Button size="sm" className="sidebar-item-menu-item sidebar-item-rename" role="menuitem" onClick={onRename}>
        <PencilIcon size={13} strokeWidth={1.4} />
        <span>{t('sidebar.renameWorkspace')}</span>
      </Button>
      <Button
        size="sm"
        className="sidebar-item-menu-item sidebar-item-settings"
        role="menuitem"
        onClick={onOpenSettings}
      >
        <SettingsIcon size={13} strokeWidth={1.4} />
        <span>{t('sidebar.workspaceSettings')}</span>
      </Button>
      <Button size="sm" className="sidebar-item-menu-item sidebar-item-export" role="menuitem" onClick={onExport}>
        <ExportIcon size={13} strokeWidth={1.5} />
        <span>{t('sidebar.exportWorkspace')}</span>
      </Button>
      {canDelete && (
        <>
          <div className="sidebar-item-menu-separator" />
          <Button
            size="sm"
            className="sidebar-item-menu-item sidebar-item-menu-item--danger sidebar-item-delete"
            role="menuitem"
            onClick={onDelete}
          >
            <TrashIcon size={13} />
            <span>{t('sidebar.delete')}</span>
          </Button>
        </>
      )}
    </Popover>
  );
};
