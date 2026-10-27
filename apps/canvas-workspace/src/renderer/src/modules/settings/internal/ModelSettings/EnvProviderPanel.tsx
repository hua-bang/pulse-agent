import type { CanvasModelStatus } from '../../../../types';
import { PlusIcon } from '../../../../components/icons';
import { Button } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';

/** Read-only view of the env-key setup chat runs on when no provider is saved. */
export const EnvProviderPanel = ({
  status,
  onAddProvider,
}: {
  status: CanvasModelStatus;
  onAddProvider: () => void;
}) => {
  const { t } = useI18n();
  const env = status.resolvedApiKeyEnv ?? 'API key';

  return (
    <div className="chat-model-settings-card chat-model-settings-card--intro chat-model-env-panel">
      <div>
        <strong>{t('models.envProvider', { env })}</strong>
        <p>{t('models.envDescription')}</p>
        <dl className="chat-model-env-panel__facts">
          <dt>{t('models.envModel')}</dt>
          <dd>{status.resolvedModel}</dd>
          {status.resolvedBaseURL && (
            <>
              <dt>{t('toolsConfig.baseUrl')}</dt>
              <dd>{status.resolvedBaseURL}</dd>
            </>
          )}
        </dl>
        <Button size="sm" onClick={onAddProvider}>
          <PlusIcon size={13} />
          {t('models.addProvider')}
        </Button>
      </div>
    </div>
  );
};
