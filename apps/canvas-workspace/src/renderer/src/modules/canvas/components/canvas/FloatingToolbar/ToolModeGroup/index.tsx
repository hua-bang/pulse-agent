import { useI18n, type I18nKey } from '../../../../../../i18n';
import { ShapeToolButton } from '../ShapeToolButton';

interface Props {
  activeTool: string;
  onToolChange: (tool: string) => void;
  showShapes?: boolean;
}

const TOOLS: Array<{
  id: string;
  labelKey: I18nKey;
  icon: JSX.Element;
}> = [
  {
    id: 'select',
    labelKey: 'canvas.toolbar.select',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M4 2l10 6.5L9 10l-1.5 6L4 2z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'connect',
    labelKey: 'canvas.toolbar.connect',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="14" cy="14" r="2" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M5.5 5.5L12.5 12.5"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export const ToolModeGroup = ({ activeTool, onToolChange, showShapes = false }: Props) => {
  const { t } = useI18n();

  return (
    <div className="toolbar-group">
      {TOOLS.map((tool) => {
        const label = t(tool.labelKey);
        const active = activeTool === tool.id;
        return (
          <button
            key={tool.id}
            className={`toolbar-btn${active ? ' toolbar-btn--active' : ''}`}
            onClick={() => onToolChange(tool.id)}
            title={label}
            aria-label={label}
            aria-pressed={active}
          >
            {tool.icon}
          </button>
        );
      })}
      {showShapes && (
        <ShapeToolButton activeTool={activeTool} onToolChange={onToolChange} />
      )}
    </div>
  );
};
