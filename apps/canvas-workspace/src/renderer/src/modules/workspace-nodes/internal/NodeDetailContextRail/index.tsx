import './index.css';
import type { ReactNode } from 'react';
import { useI18n } from '../../../../i18n';

interface Props {
  aiInsight: ReactNode;
}

export const NodeDetailContextRail = ({ aiInsight }: Props) => {
  const { t } = useI18n();
  return (
    <aside className="node-detail-panel__context-rail" aria-label={t('workspaceNodes.aiSummary')}>
      {aiInsight}
    </aside>
  );
};
