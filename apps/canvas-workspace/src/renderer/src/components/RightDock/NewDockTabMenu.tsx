import type { RefObject } from 'react';
import { useI18n } from '../../i18n';
import { NodeTypeIcon } from '../icons';
import { Button, Popover } from '../ui';
import './new-tab-menu.css';

interface Props {
  anchorRef: RefObject<HTMLSpanElement>;
  panelId: string;
  showTerminal: boolean;
  onClose: () => void;
  onOpenNode: () => void;
  onOpenCanvas: () => void;
  onNewWebTab: () => void;
  onNewTerminalTab: () => void;
}

export const NewDockTabMenu = ({ anchorRef, panelId, showTerminal, onClose, onOpenNode, onOpenCanvas, onNewWebTab, onNewTerminalTab }: Props) => {
  const { t } = useI18n();

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
        >
          <Button
            size="sm"
            className="right-dock__new-tab-item"
            role="menuitem"
            onClick={() => {
              onClose();
              onOpenNode();
            }}
          >
            <NodeTypeIcon type="file" size={15} />
            {t('rightDock.openNode')}
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
            <NodeTypeIcon type="frame" size={15} />
            {t('rightDock.openCanvas')}
          </Button>
          <Button
            size="sm"
            className="right-dock__new-tab-item"
            role="menuitem"
            onClick={() => {
              onClose();
              onNewWebTab();
            }}
          >
            <NodeTypeIcon type="iframe" size={15} />
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
              <NodeTypeIcon type="terminal" size={15} />
              {t('rightDock.newTerminalTab')}
            </Button>
          )}
        </Popover>
  );
};
