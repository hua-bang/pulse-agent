import { Button, Popover } from '../../../../../components/ui';
import { useI18n } from '../../../../../i18n';

interface Props {
  x: number;
  y: number;
  title: string;
  pinned: boolean;
  onClose: () => void;
  onTogglePin?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}

/** Right-click menu of a session row: the row's hover actions, with labels. */
export const ChatSessionRailMenu = ({
  x,
  y,
  title,
  pinned,
  onClose,
  onTogglePin,
  onRename,
  onDelete,
}: Props) => {
  const { t } = useI18n();
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <Popover
      x={x}
      y={y}
      onClose={onClose}
      ariaLabel={t('chat.sessionMenu.label', { title })}
      className="context-menu context-menu--in-dock"
    >
      {onTogglePin && (
        <Button size="sm" className="context-menu-item" role="menuitem" onClick={run(onTogglePin)}>
          {t(pinned ? 'chat.sessionMenu.unpin' : 'chat.sessionMenu.pin')}
        </Button>
      )}
      {onRename && (
        <Button size="sm" className="context-menu-item" role="menuitem" onClick={run(onRename)}>
          {t('sidebar.rename')}
        </Button>
      )}
      {onDelete && (
        <Button size="sm" className="context-menu-item" role="menuitem" onClick={run(onDelete)}>
          {t('chat.deleteSessionAction')}
        </Button>
      )}
    </Popover>
  );
};
