import type { CanvasModelProviderConfig, CanvasModelProviderStatus } from '../../types';
import { RefreshIcon } from '../icons';
import { ApiKeyStatusHint } from './ApiKeyStatusHint';
import { useI18n } from '../../i18n';

interface ProviderFieldsProps {
  activeProviderId: string;
  activeProviderStatus?: CanvasModelProviderStatus;
  addManualModel: () => void;
  draft: CanvasModelProviderConfig;
  fetching: boolean;
  fetchModels: () => Promise<void>;
  manualModel: string;
  removeModel: (modelId: string) => void;
  setDraftField: <K extends keyof CanvasModelProviderConfig>(key: K, value: CanvasModelProviderConfig[K]) => void;
  setManualModel: (value: string) => void;
}

export const ModelProviderFields = ({
  activeProviderId,
  activeProviderStatus,
  addManualModel,
  draft,
  fetching,
  fetchModels,
  manualModel,
  removeModel,
  setDraftField,
  setManualModel,
}: ProviderFieldsProps) => {
  const { t } = useI18n();

  return (
    <>
      <label className="chat-model-field">
        <span>{t('models.providerName')}</span>
        <input value={draft.name} placeholder={t('models.providerNamePlaceholder')} onChange={(event) => setDraftField('name', event.target.value)} />
      </label>

      <div className="chat-model-field">
        <span>{t('models.protocol')}</span>
        <div role="radiogroup" aria-label={t('models.protocolAria')} className="chat-model-protocol-toggle">
          <ProtocolOption
            active={(draft.provider_type ?? 'openai') === 'openai'}
            title={t('models.openaiCompatible')}
            subtitle="/v1/chat/completions"
            onClick={() => setDraftField('provider_type', 'openai')}
          />
          <ProtocolOption
            active={draft.provider_type === 'claude'}
            title={t('models.claudeAnthropic')}
            subtitle="/v1/messages"
            onClick={() => setDraftField('provider_type', 'claude')}
          />
        </div>
      </div>

      <label className="chat-model-field">
        <span>{t('models.baseUrl')}</span>
        <input
          value={draft.base_url ?? ''}
          placeholder={draft.provider_type === 'claude' ? 'https://api.anthropic.com/v1' : 'https://api.deepseek.com/v1'}
          onChange={(event) => setDraftField('base_url', event.target.value)}
        />
      </label>

      <label className="chat-model-field">
        <span>{t('models.apiKey')}</span>
        <input
          value={draft.api_key ?? ''}
          type="password"
          placeholder={activeProviderStatus?.apiKeyPresent ? t('models.keepSavedKeyPlaceholder') : t('models.enterApiKeyPlaceholder')}
          onChange={(event) => setDraftField('api_key', event.target.value)}
        />
        {activeProviderId !== 'new' && (
          <ApiKeyStatusHint
            status={activeProviderStatus}
            drafting={Boolean(draft.api_key && draft.api_key.length > 0)}
          />
        )}
      </label>

      <div className="chat-model-field-row">
        <label className="chat-model-field chat-model-field--grow">
          <span>{t('models.models')}</span>
          <input
            value={manualModel}
            placeholder="deepseek-chat"
            onChange={(event) => setManualModel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addManualModel();
              }
            }}
          />
        </label>
        <button type="button" className="chat-model-secondary-btn" onClick={addManualModel}>{t('models.add')}</button>
        <button type="button" className="chat-model-secondary-btn" onClick={() => void fetchModels()} disabled={fetching}>
          <RefreshIcon />
          {fetching ? t('models.fetching') : t('models.fetch')}
        </button>
      </div>

      <div className="chat-model-model-list">
        {(draft.models ?? []).length > 0 ? draft.models?.map((model) => (
          <span key={model.id} className="chat-model-chip">
            {model.name ?? model.id}
            <button type="button" onClick={() => removeModel(model.id)} aria-label={t('models.removeModel', { id: model.id })}>×</button>
          </span>
        )) : (
          <div className="chat-model-settings-empty">{t('models.emptyModelList')}</div>
        )}
      </div>
    </>
  );
};

const ProtocolOption = ({
  active,
  onClick,
  subtitle,
  title,
}: {
  active: boolean;
  onClick: () => void;
  subtitle: string;
  title: string;
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={active}
    className={`chat-model-protocol-option${active ? ' chat-model-protocol-option--active' : ''}`}
    onClick={onClick}
  >
    <span className="chat-model-protocol-title">{title}</span>
    <span className="chat-model-protocol-sub">{subtitle}</span>
  </button>
);
