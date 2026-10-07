import type { RefObject } from 'react';
import { useGuestInteractionShield } from '../../../../../platform/browser/useGuestInteractionShield';
import { useI18n } from '../../../../../i18n';
import { NodeTypeIcon, FolderIcon } from '../../../../../components/icons';
import { Button, Popover } from '../../../../../components/ui';
import './new-tab-menu.css';

interface Props {
  anchorRef: RefObject<HTMLSpanElement>;
  panelId: string;
  showTerminal: boolean;
  onClose: () => void;
  onOpenFolder: () => void;
  onOpenNode: () => void;
  showOpenNode?: boolean;
  onOpenCanvas: () => void;
  onNewWebTab: () => void;
  onNewTerminalTab: () => void;
  /** Hover-open support: pointer entered/left the portaled panel (the menu is
   *  opened by hovering the + trigger; these keep it open over the panel). */
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
}

export const NewDockTabMenu = ({ anchorRef, panelId, showTerminal, onClose, onOpenFolder, onOpenNode, showOpenNode = false, onOpenCanvas, onNewWebTab, onNewTerminalTab, onHoverEnter, onHoverLeave }: Props) => {
  const { t } = useI18n();
  useGuestInteractionShield(true);

  return (
    <Popover
      anchorRef={anchorRef}
      placement="bottom"
      align="end"
      gap={6}
      viewportMargin={8}
      onClose={(reason) => {
        onClose();
        if (reason === 'escape') anchorRef.current?.querySelector('button')?.focus();
      }}
      className="right-dock__new-tab-panel"
      ariaLabel={t('rightDock.newTabMenu')}
      panelId={panelId}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
    >
      <Button
        size="sm"
        className="right-dock__new-tab-item"
        role="menuitem"
        onClick={() => {
          onClose();
          onNewWebTab();
        }}
      >
        <NodeTypeIcon type="iframe" size={15} colorize />
        {t('rightDock.newWebTab')}
      </Button>

      {showTerminal && (
        <Button
          size="sm"
          className="right-dock__new-tab-item"
          role="menuitem"
          onClick={() => {
            onClose();
            onNewTerminalTab();
          }}
        >
          <NodeTypeIcon type="terminal" size={15} colorize />
          {t('rightDock.newTerminalTab')}
        </Button>
      )}

      <Button size="sm" className="right-dock__new-tab-item" role="menuitem"
        onClick={() => { onClose(); onOpenFolder(); }}>
        <FolderIcon size={14} className="right-dock__folder-icon" />
        {t('rightDock.openFolder')}
      </Button>
      <Button
        size="sm"
        className="right-dock__new-tab-item"
        role="menuitem"
        onClick={() => {
          onClose();
          onOpenCanvas();
        }}
      >
        <NodeTypeIcon type="frame" size={15} colorize />
        {t('rightDock.openCanvas')}
      </Button>
      {showOpenNode && <Button
        size="sm"
        className="right-dock__new-tab-item"
        role="menuitem"
        onClick={() => {
          onClose();
          onOpenNode();
        }}
      >
        <NodeTypeIcon type="file" size={15} colorize />
        {t('rightDock.openNode')}
      </Button>}
    </Popover>
  );
};
