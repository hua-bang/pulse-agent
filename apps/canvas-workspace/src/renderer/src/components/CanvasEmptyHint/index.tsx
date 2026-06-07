import { EMPTY_CANVAS_ACTIONS } from '../../constants/interaction';
import type { CanvasNode } from '../../types';
import { AppLogoIcon } from '../icons';
import { useI18n } from '../../i18n';
import './index.css';

interface CanvasEmptyHintProps {
  onCreateNode: (type: Extract<CanvasNode['type'], 'agent' | 'terminal' | 'file' | 'iframe'>) => void;
  onOpenShortcuts: () => void;
}

export const CanvasEmptyHint = ({ onCreateNode, onOpenShortcuts }: CanvasEmptyHintProps) => {
  const { t } = useI18n();

  return (
    <div className="canvas-empty-hint">
      <div className="canvas-empty-card">
        <div className="hint-icon">
          <AppLogoIcon size={34} />
        </div>
        <div className="hint-text">{t('canvas.empty.title')}</div>
        <div className="hint-sub">{t('canvas.empty.description')}</div>
        <div className="canvas-empty-actions">
          {EMPTY_CANVAS_ACTIONS.map((action) => (
            <button
              key={action.actionKey}
              type="button"
              className="canvas-empty-action"
              onClick={() => onCreateNode(action.nodeType)}
            >
              <span className="canvas-empty-action__label">{t(action.labelKey)}</span>
              <span className="canvas-empty-action__description">{t(action.descriptionKey)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="canvas-empty-shortcuts" onClick={onOpenShortcuts}>
          <span className="canvas-empty-shortcuts__key">?</span>
          <span>{t('canvas.empty.showShortcuts')}</span>
        </button>
      </div>
    </div>
  );
};
