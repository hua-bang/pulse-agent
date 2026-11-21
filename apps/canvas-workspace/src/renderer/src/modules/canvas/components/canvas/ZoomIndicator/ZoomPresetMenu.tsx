import '../NodeContextMenu/index.css';
import type { RefObject } from 'react';
import { Button } from '../../../../../components/ui';
import { Popover } from '../../../../../components/ui/Popover';

export interface ZoomPresetMenuItem {
  key: string;
  label: string;
  run: () => void;
}

/**
 * The percentage menu. It is closed during first paint, so the popover and
 * the shared context-menu styles load with the first open.
 */
export const ZoomPresetMenu = ({
  anchorRef,
  ariaLabel,
  items,
  onClose,
}: {
  anchorRef: RefObject<HTMLButtonElement>;
  ariaLabel: string;
  items: readonly ZoomPresetMenuItem[];
  onClose: () => void;
}) => (
  <Popover
    anchorRef={anchorRef}
    placement="top"
    align="end"
    ariaLabel={ariaLabel}
    className="context-menu zoom-indicator-menu"
    onClose={onClose}
  >
    {items.map((item) => (
      <Button
        key={item.key}
        size="sm"
        role="menuitem"
        className="context-menu-item"
        onClick={() => {
          onClose();
          item.run();
        }}
      >
        <span className="context-menu-label">
          <strong>{item.label}</strong>
        </span>
      </Button>
    ))}
  </Popover>
);
