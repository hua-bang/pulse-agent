import '../NodeContextMenu/index.css';
import './index.css';
import { Button } from '../../../../../components/ui';
import { Popover } from '../../../../../components/ui/Popover';
import { useI18n } from '../../../../../i18n';
import type { CanvasNode } from '../../../../../types';
import type { PaletteCommand } from '../CommandPalette';

/** Palette commands that act on the selection, in menu order. */
const NODE_MENU_COMMAND_IDS = [
  'duplicate-selection',
  'group-selection',
  'ungroup-selection',
  'wrap-selection-in-frame',
  'pin-reference',
  'toggle-focus-mode',
  'delete-selection',
];

/** The commands the node menu shows, taken from the Cmd+K palette list. */
export const selectNodeMenuCommands = (commands: readonly PaletteCommand[]): PaletteCommand[] => (
  NODE_MENU_COMMAND_IDS
    .map((id) => commands.find((command) => command.id === id))
    .filter((command): command is PaletteCommand => !!command && command.enabled !== false)
);

/**
 * The node under a canvas point. Containers sit behind their children, so
 * the smallest node that holds the point is the one the user sees on top.
 */
export const findNodeAtPoint = (
  nodes: readonly CanvasNode[],
  point: { x: number; y: number },
): CanvasNode | undefined => {
  let hit: CanvasNode | undefined;
  for (const node of nodes) {
    const inside = point.x >= node.x && point.x <= node.x + node.width
      && point.y >= node.y && point.y <= node.y + node.height;
    if (inside && (!hit || node.width * node.height < hit.width * hit.height)) hit = node;
  }
  return hit;
};

interface Props {
  x: number;
  y: number;
  commands: PaletteCommand[];
  onClose: () => void;
}

/**
 * Right-click menu for canvas nodes. It reuses the palette's selection
 * commands, so the menu, Cmd+K, and the shortcuts always offer the same
 * actions with the same labels.
 */
export const NodeActionsMenu = ({ x, y, commands, onClose }: Props) => {
  const { t } = useI18n();
  const items = selectNodeMenuCommands(commands);
  if (items.length === 0) return null;

  return (
    <Popover x={x} y={y} onClose={onClose} className="context-menu node-actions-menu">
      <div className="context-menu-title">{t('canvas.nodeActionsMenu.title')}</div>
      {items.map((command) => (
        <Button
          key={command.id}
          size="sm"
          role="menuitem"
          className={`context-menu-item${command.id === 'delete-selection' ? ' context-menu-item--danger' : ''}`}
          onClick={() => {
            onClose();
            command.run();
          }}
        >
          <span className="context-menu-label">
            <strong>{command.title}</strong>
          </span>
          {command.shortcut && <kbd className="node-actions-menu__shortcut">{command.shortcut}</kbd>}
        </Button>
      ))}
    </Popover>
  );
};
