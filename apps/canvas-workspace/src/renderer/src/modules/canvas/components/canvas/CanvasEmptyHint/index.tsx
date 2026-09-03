import type { CanvasNode } from '../../../../../types';
import { AppLogoIcon } from '../../../../../components/icons';
import { NodeTypeBadge } from '../CanvasNodeView/NodeTypeBadge';
import { useI18n } from '../../../../../i18n';
import './index.css';

interface Props {
  onCreateNode: (type: Extract<CanvasNode['type'], 'agent' | 'file'>) => void;
  onCreateDemo?: () => void;
  onOpenShortcuts: () => void;
  onSetRootFolder?: () => void;
}

export const CanvasEmptyHint = ({
  onCreateNode,
  onCreateDemo,
  onOpenShortcuts,
  onSetRootFolder,
}: Props) => {
  const { t } = useI18n();
  const actions = [
    {
      key: 'project',
      icon: <NodeTypeBadge type="file" />,
      label: t('canvas.empty.setProjectFolder'),
      description: t('canvas.empty.setProjectFolderDescription'),
      onClick: onSetRootFolder,
    },
    {
      key: 'brief',
      icon: <NodeTypeBadge type="file" />,
      label: t('canvas.empty.newNote'),
      description: t('canvas.empty.newNoteDescription'),
      onClick: () => onCreateNode('file'),
    },
    {
      key: 'agent',
      icon: <NodeTypeBadge type="agent" />,
      label: t('canvas.empty.createAgent'),
      description: t('canvas.empty.createAgentDescription'),
      onClick: () => onCreateNode('agent'),
    },
  ].filter((action) => Boolean(action.onClick));

  return (
    <div className="canvas-empty-hint">
      <section className="canvas-empty-card" aria-labelledby="canvas-empty-title">
        <div className="hint-icon">
          <AppLogoIcon size={30} />
        </div>
        <div className="canvas-empty-heading">
          <div className="canvas-empty-eyebrow">{t('canvas.empty.eyebrow')}</div>
          <h2 id="canvas-empty-title" className="hint-text">{t('canvas.empty.title')}</h2>
          <p className="hint-sub">{t('canvas.empty.description')}</p>
        </div>

        <div className="canvas-empty-actions">
          {actions.map((action, index) => (
            <button
              key={action.key}
              type="button"
              className="canvas-empty-action"
              onClick={action.onClick}
            >
              <span className="canvas-empty-action__step">
                {t('canvas.empty.step', { count: index + 1 })}
              </span>
              <span className="canvas-empty-action__icon">{action.icon}</span>
              <span className="canvas-empty-action__copy">
                <span className="canvas-empty-action__label">{action.label}</span>
                <span className="canvas-empty-action__description">{action.description}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="canvas-empty-footer">
          {onCreateDemo && (
            <button type="button" className="canvas-empty-link" onClick={onCreateDemo}>
              {t('canvas.empty.demoCanvas')}
            </button>
          )}
          <button type="button" className="canvas-empty-link" onClick={onOpenShortcuts}>
            {t('canvas.empty.showShortcuts')}
          </button>
        </div>
      </section>
    </div>
  );
};
