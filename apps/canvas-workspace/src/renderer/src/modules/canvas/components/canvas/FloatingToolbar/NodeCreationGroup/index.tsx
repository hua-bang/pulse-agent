import { NodeTypeIcon } from '../../../../../../components/icons';
import { useI18n, type I18nKey } from '../../../../../../i18n';
import { TerminalToolSplitButton } from '../TerminalToolSplitButton';
import type { AddCanvasNode } from '../types';

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
  { type: 'frame', labelKey: 'canvas.toolbar.addFrame', tooltipKey: 'canvas.toolbar.frame' },
  { type: 'iframe', labelKey: 'canvas.toolbar.addWeb', tooltipKey: 'canvas.toolbar.web' },
  { type: 'agent', labelKey: 'canvas.toolbar.addCodingAgent', tooltipKey: 'canvas.toolbar.coding' },
] as const satisfies ReadonlyArray<{
  type: Parameters<AddCanvasNode>[0];
  labelKey: I18nKey;
  tooltipKey: I18nKey;
}>;

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
      {CREATION_ACTIONS.map((action) => (
        <button
          key={action.type}
          className="toolbar-btn toolbar-btn--create"
          onClick={() => onAddNode(action.type)}
          aria-label={t(action.labelKey)}
          data-tooltip={t(action.tooltipKey)}
        >
          <NodeTypeIcon type={action.type} size={18} />
          <span className="toolbar-btn-label">{t(action.tooltipKey)}</span>
        </button>
      ))}
      <TerminalToolSplitButton
        open={terminalDockOpen}
        showAdd={showTerminalAdd}
        onToggle={onTerminalToggle}
        onNewTerminal={onNewTerminal}
      />
      <button
        className="toolbar-btn toolbar-btn--create"
        onClick={() => onAddNode('mindmap')}
        aria-label={t('canvas.toolbar.addMindmap')}
        data-tooltip={t('canvas.toolbar.mindmap')}
      >
        <NodeTypeIcon type="mindmap" size={18} />
        <span className="toolbar-btn-label">{t('canvas.toolbar.mindmap')}</span>
      </button>
    </div>
  );
};
