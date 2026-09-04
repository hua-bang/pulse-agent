import './index.css';
import { useI18n } from '../../../../i18n';
import { Button } from '../../../../components/ui';

interface Props {
  onDiscard: () => void;
  onRetry: () => void;
  retrying: boolean;
}

export const NodeCanvasSaveError = ({ onDiscard, onRetry, retrying }: Props) => {
  const { t } = useI18n();

  return (
    <div className="node-canvas-preview__save-error" role="alert">
      <span>{t('workspaceNodes.saveFailed')}</span>
      <Button size="xs" variant="primary" disabled={retrying} onClick={onRetry}>
        {t('workspaceNodes.retry')}
      </Button>
      <Button size="xs" disabled={retrying} onClick={onDiscard}>
        {t('workspaceNodes.discardChanges')}
      </Button>
    </div>
  );
};

