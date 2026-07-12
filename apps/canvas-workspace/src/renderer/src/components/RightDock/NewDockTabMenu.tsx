import { useId, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { NodeTypeIcon, PlusIcon } from '../icons';
import { Button, Popover } from '../ui';
import './new-tab-menu.css';

interface Props {
  showTerminal: boolean;
  onOpenNode: () => void;
  onNewWebTab: () => void;
  onNewTerminalTab: () => void;
}

export const NewDockTabMenu = ({ showTerminal, onOpenNode, onNewWebTab, onNewTerminalTab }: Props) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  return (
    <span ref={anchorRef} className="right-dock__new-tab-menu">
      <Button
        variant="icon"
        size="sm"
        className="right-dock__new-link"
        aria-label={t('rightDock.newTab')}
        title={t('rightDock.newTab')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <PlusIcon size={16} />
      </Button>
      {open && (
        <Popover
          anchorRef={anchorRef}
          placement="bottom"
          align="end"
          gap={6}
          viewportMargin={8}
          onClose={(reason) => {
            setOpen(false);
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
              setOpen(false);
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
              setOpen(false);
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
                setOpen(false);
                onNewTerminalTab();
              }}
            >
              <NodeTypeIcon type="terminal" size={15} />
              {t('rightDock.newTerminalTab')}
            </Button>
          )}
        </Popover>
      )}
    </span>
  );
};
