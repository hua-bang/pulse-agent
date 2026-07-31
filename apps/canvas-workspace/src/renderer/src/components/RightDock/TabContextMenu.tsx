/**
 * Right-click menu for a dock tab.
 *
 * Everything here was previously reachable only one tab at a time (or not at
 * all): closing a run of tabs meant hunting the × on each one, and a web
 * tab's address could not be copied without focusing it first.
 *
 * Bulk closes go through `store.close` one tab at a time on purpose — each
 * closed web tab lands on the reopen stack, so ⌘/Ctrl+Shift+T walks them
 * back exactly as it does after individual closes.
 */
import { useI18n, type I18nKey } from '../../i18n';
import { useGuestInteractionShield } from '../../hooks/useGuestInteractionShield';
import { Button, Popover } from '../ui';
import type { DockPreviewTab, DockStore } from './dock-store';

interface Props {
  tab: DockPreviewTab;
  tabs: readonly DockPreviewTab[];
  store: DockStore;
  x: number;
  y: number;
  onClose: () => void;
  onActionComplete?: () => void;
}

export const TabContextMenu = ({
  tab,
  tabs,
  store,
  x,
  y,
  onClose,
  onActionComplete = () => undefined,
}: Props) => {
  const { t } = useI18n();
  useGuestInteractionShield(true);
  const index = tabs.findIndex((item) => item.id === tab.id);
  const others = tabs.filter((item) => item.id !== tab.id);
  const toTheRight = index === -1 ? [] : tabs.slice(index + 1);

  const run = (action: () => void) => () => {
    onClose();
    action();
    onActionComplete();
  };

  const closeAll = (targets: readonly DockPreviewTab[]) => () => {
    for (const target of targets) store.close(target.id);
  };

  const item = (key: I18nKey, onClick: () => void, disabled = false) => (
    <Button
      size="sm"
      className="context-menu-item"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="context-menu-label">
        <strong>{t(key)}</strong>
      </span>
    </Button>
  );

  const closeMenu = (reason?: 'escape' | 'outside') => {
    onClose();
    if (reason === 'escape') onActionComplete();
  };

  return (
    <Popover x={x} y={y} onClose={closeMenu} className="context-menu context-menu--in-dock">
      {tab.kind === 'link' && tab.url && (
        <>
          {item('rightDock.tabMenu.copyAddress', run(
            () => void navigator.clipboard?.writeText(tab.url).catch(() => undefined),
          ))}
          {item('rightDock.tabMenu.openExternally', run(
            () => void window.canvasWorkspace.shell.openExternal(tab.url),
          ))}
        </>
      )}
      {item('rightDock.tabMenu.close', run(() => store.close(tab.id)))}
      {item('rightDock.tabMenu.closeOthers', run(closeAll(others)), others.length === 0)}
      {item('rightDock.tabMenu.closeToTheRight', run(closeAll(toTheRight)), toTheRight.length === 0)}
      {item(
        'rightDock.tabMenu.reopenClosed',
        run(() => store.reopenClosedTab()),
        !store.canReopenClosedTab(),
      )}
    </Popover>
  );
};
