import type { CanvasNode } from '../../types';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { EmptyState } from '../ui';
import { useI18n } from '../../i18n';

export const ReferenceEmptyState = ({ selectedNode }: { selectedNode?: CanvasNode }) => {
  const { t } = useI18n();

  return (
    <EmptyState
      className="reference-empty"
      icon={
        <div className="reference-empty-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M5.2 2.8h7.6a1.4 1.4 0 011.4 1.4v10.6L9 11.8l-5.2 3V4.2a1.4 1.4 0 011.4-1.4z"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinejoin="round"
            />
            <path d="M6.6 6.2h4.8M6.6 8.7h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </svg>
        </div>
      }
      title={t('reference.noPinnedTitle')}
      titleAs="h3"
      description={t('reference.noPinnedDescription')}
      action={
        selectedNode ? (
          <div className="reference-selected-hint">
            <span>{t('reference.selected')}</span>
            <strong>{getNodeDisplayLabel(selectedNode)}</strong>
          </div>
        ) : (
          <div className="reference-selected-hint reference-selected-hint--muted">
            {t('reference.emptyHint')}
          </div>
        )
      }
    />
  );
};
