import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { NodeTypeIcon } from '../../../../../../components/icons';
import { DropdownShell } from '../../../../../../components/ui';
import { useI18n, type I18nKey } from '../../../../../../i18n';
import { TerminalToolSplitButton } from '../TerminalToolSplitButton';
import type { AddCanvasNode } from '../types';
import './index.css';

interface Props {
  terminalDockOpen: boolean;
  showTerminalAdd: boolean;
  onAddNode: AddCanvasNode;
  onTerminalToggle: () => void;
  onNewTerminal: () => void;
}

const CREATION_ACTIONS = [
  { type: 'text', labelKey: 'canvas.toolbar.addText', tooltipKey: 'canvas.toolbar.text' },
  { type: 'file', labelKey: 'canvas.toolbar.addNote', tooltipKey: 'canvas.toolbar.note' },
  { type: 'mindmap', labelKey: 'canvas.toolbar.addMindmap', tooltipKey: 'canvas.toolbar.mindmap' },
  { type: 'frame', labelKey: 'canvas.toolbar.addFrame', tooltipKey: 'canvas.toolbar.frame' },
  { type: 'iframe', labelKey: 'canvas.toolbar.addWeb', tooltipKey: 'canvas.toolbar.web' },
  { type: 'agent', labelKey: 'canvas.toolbar.addCodingAgent', tooltipKey: 'canvas.toolbar.coding' },
] as const satisfies ReadonlyArray<{
  type: Parameters<AddCanvasNode>[0];
  labelKey: I18nKey;
  tooltipKey: I18nKey;
}>;

interface CreateButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
}

// One button shape for the inline actions, the compact "+" trigger, and the
// compact menu items, so all three share label and tooltip behavior.
const CreateButton = ({ icon, label, className, ...rest }: CreateButtonProps) => (
  <button type="button" className={`toolbar-btn ${className ?? ''}`} {...rest}>
    {icon}
    <span className="toolbar-btn-label">{label}</span>
  </button>
);

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M9 3.5v11M3.5 9h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const NodeCreationGroup = ({
  terminalDockOpen,
  showTerminalAdd,
  onAddNode,
  onTerminalToggle,
  onNewTerminal,
}: Props) => {
  const { t } = useI18n();

  return (
    <div className="toolbar-group">
      {/* Wide canvases show every creation action inline. Narrow canvases
          (container query in index.css) fold them into one "+" menu so the
          toolbar, zoom chrome, and Agent button can share one row. */}
      <div className="toolbar-group toolbar-create-inline">
        {CREATION_ACTIONS.map((action) => (
          <CreateButton
            key={action.type}
            className="toolbar-btn--create"
            onClick={() => onAddNode(action.type)}
            aria-label={t(action.labelKey)}
            data-tooltip={t(action.tooltipKey)}
            icon={<NodeTypeIcon type={action.type} size={18} />}
            label={t(action.tooltipKey)}
          />
        ))}
      </div>
      <DropdownShell
        className="toolbar-create-compact"
        panelClassName="toolbar-create-menu"
        placement="top"
        align="center"
        ariaLabel={t('canvas.toolbar.addNodeMenu')}
        trigger={({ open, toggle }) => (
          <CreateButton
            className={`toolbar-btn--create${open ? ' toolbar-btn--active' : ''}`}
            onClick={toggle}
            aria-label={t('canvas.toolbar.addNodeMenu')}
            aria-haspopup="menu"
            aria-expanded={open}
            data-tooltip={open ? undefined : t('canvas.toolbar.addNodeMenu')}
            icon={<PlusIcon />}
            label={t('canvas.toolbar.add')}
          />
        )}
      >
        {({ close }) => CREATION_ACTIONS.map((action) => (
          <CreateButton
            key={action.type}
            className="toolbar-create-menu__item"
            role="menuitem"
            onClick={() => {
              close();
              onAddNode(action.type);
            }}
            aria-label={t(action.labelKey)}
            icon={<NodeTypeIcon type={action.type} size={18} />}
            label={t(action.tooltipKey)}
          />
        ))}
      </DropdownShell>
      <div className="toolbar-divider" />
      <TerminalToolSplitButton
        open={terminalDockOpen}
        showAdd={showTerminalAdd}
        onToggle={onTerminalToggle}
        onNewTerminal={onNewTerminal}
      />
    </div>
  );
};
