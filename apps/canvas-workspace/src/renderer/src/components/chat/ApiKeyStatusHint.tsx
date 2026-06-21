import type { CanvasModelProviderStatus } from '../../types';
import { useI18n } from '../../i18n';

interface ApiKeyStatusHintProps {
  status?: CanvasModelProviderStatus;
  drafting: boolean;
}

export const ApiKeyStatusHint = ({ status, drafting }: ApiKeyStatusHintProps) => {
  const { t } = useI18n();
  if (drafting) {
    return <span className="chat-model-field-hint chat-model-field-hint--info">{t('apiKeyHint.willOverwrite')}</span>;
  }
  if (!status) return null;
  if (status.apiKeyPresent) {
    const length = status.apiKeyLength;
    const lengthSuffix = typeof length === 'number' && length > 0 ? t('apiKeyHint.charCount', { length }) : '';
    const source = status.api_key_env && !length ? t('apiKeyHint.fromEnv', { env: status.api_key_env }) : '';
    return (
      <span className="chat-model-field-hint chat-model-field-hint--ok">
        {t('apiKeyHint.saved')}{lengthSuffix}{source}
      </span>
    );
  }
  return <span className="chat-model-field-hint chat-model-field-hint--warn">{t('apiKeyHint.notSet')}</span>;
};
