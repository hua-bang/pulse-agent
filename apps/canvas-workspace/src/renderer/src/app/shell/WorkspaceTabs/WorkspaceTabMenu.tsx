import type { RefObject } from 'react';
import { CloseIcon } from '../../../components/icons';
import { Button, Popover } from '../../../components/ui';
import { useI18n } from '../../../i18n';

interface Props {
  anchorRef: RefObject<HTMLButtonElement>;
  name: string;
  canCloseOthers: boolean;
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
}

/** Right-click menu of a workspace tab. Reuses the sidebar row menu styles. */
export const WorkspaceTabMenu = ({
  anchorRef,
  name,
  canCloseOthers,
  onClose,
  onCloseTab,
  onCloseOthers,
}: Props) => {
  const { t } = useI18n();

  return (
    <Popover
      anchorRef={anchorRef}
      placement="bottom"
      align="start"
      gap={4}
      ariaLabel={t('workspaceTabs.menu', { name })}
      className="sidebar-item-menu workspace-tabs__menu"
      onClose={onClose}
    >
      <Button size="sm" className="sidebar-item-menu-item" role="menuitem" onClick={onCloseTab}>
        <CloseIcon size={11} />
        <span>{t('workspaceTabs.closeTab')}</span>
      </Button>
      {canCloseOthers && (
        <Button size="sm" className="sidebar-item-menu-item" role="menuitem" onClick={onCloseOthers}>
          <span>{t('workspaceTabs.closeOthers')}</span>
        </Button>
      )}
    </Popover>
  );
};
