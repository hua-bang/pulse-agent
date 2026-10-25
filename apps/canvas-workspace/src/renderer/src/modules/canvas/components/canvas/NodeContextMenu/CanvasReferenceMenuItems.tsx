import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useI18n } from '../../../../../i18n';
import { ChevronRightIcon, NodeTypeIcon } from '../../../../../components/icons';
import { Button } from '../../../../../components/ui';
import type { WorkspaceEntry } from '../../../../../shared/workspaces';

interface Props {
  /** Every workspace except the current canvas. */
  workspaces: WorkspaceEntry[];
  onCreate: (workspaceId: string) => void;
}

const SUBMENU_WIDTH = 220;
const SUBMENU_GAP = 4;
/** Grace period for the pointer to cross from the row into the submenu. */
const CLOSE_DELAY_MS = 150;

/** Places the submenu beside the row, flipping left at the viewport edge. */
const submenuPosition = (row: DOMRect): CSSProperties => {
  const fitsRight = row.right + SUBMENU_GAP + SUBMENU_WIDTH <= window.innerWidth - 8;
  return {
    left: fitsRight ? row.right + SUBMENU_GAP : row.left - SUBMENU_GAP - SUBMENU_WIDTH,
    top: row.top - 4,
    width: SUBMENU_WIDTH,
  };
};

/**
 * "Canvas reference" row. Hovering it (or a click or ArrowRight) opens a
 * submenu with the other workspaces. The submenu stays a DOM child of the
 * menu, so the menu's outside-press dismissal never fires for it.
 */
export const CanvasReferenceMenuItems = ({ workspaces, onCreate }: Props) => {
  const { t } = useI18n();
  const rowRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number>();
  const [position, setPosition] = useState<CSSProperties | null>(null);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  if (workspaces.length === 0) return null;

  const open = () => {
    window.clearTimeout(closeTimer.current);
    const row = rowRef.current?.getBoundingClientRect();
    if (row) setPosition(submenuPosition(row));
  };
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPosition(null), CLOSE_DELAY_MS);
  };

  return (
    <div className="context-menu-submenu-host" onMouseEnter={open} onMouseLeave={scheduleClose}>
      <Button
        ref={rowRef}
        size="sm"
        className="context-menu-item"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={position !== null}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") open();
        }}
      >
        <span className="context-menu-icon context-menu-icon--reference">
          <NodeTypeIcon type="reference" size={15} />
        </span>
        <span className="context-menu-label">
          <strong>{t("canvas.menu.canvasReference")}</strong>
          <small>{t("canvas.menu.canvasReferenceDesc")}</small>
        </span>
        <ChevronRightIcon size={14} className="context-menu-chevron" />
      </Button>
      {position && (
        <div
          className="context-menu context-menu-submenu"
          role="menu"
          aria-label={t("canvas.menu.canvasReference")}
          style={position}
        >
          <div className="context-menu-title">{t("canvas.menu.canvasReferencePick")}</div>
          {workspaces.map((workspace) => (
            <Button
              key={workspace.id}
              size="sm"
              className="context-menu-item context-menu-workspace"
              role="menuitem"
              title={workspace.name}
              onClick={() => onCreate(workspace.id)}
            >
              <span className="context-menu-workspace__name">{workspace.name}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};
