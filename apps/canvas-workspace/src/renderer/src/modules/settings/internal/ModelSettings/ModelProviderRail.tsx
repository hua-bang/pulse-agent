import type { CanvasModelProviderStatus, CanvasModelStatus } from '../../../../types';
import { PlusIcon } from '../../../../components/icons';
import { useI18n } from '../../../../i18n';

interface ProviderRailProps {
  activeProviderId: string;
  providers: CanvasModelProviderStatus[];
  /** The model chat actually resolves to; marks the provider in use. */
  status?: CanvasModelStatus;
  onSelect: (providerId: string) => void;
}

export const ModelProviderRail = ({
  activeProviderId,
  providers,
  status,
  onSelect,
}: ProviderRailProps) => {
  const { t } = useI18n();
  // With no saved provider selected, chat runs on an env key. Show that
  // setup as a read-only row, or the page reads as "nothing configured".
  const envInUse = status && !status.currentProvider && status.apiKeyPresent;

  return (
    <div className="chat-model-provider-rail">
      {envInUse && (
        <div className="chat-model-provider-tab chat-model-provider-tab--readonly" title={status.resolvedBaseURL}>
          <span className="chat-model-provider-status chat-model-provider-status--ok" />
          <span className="chat-model-provider-tab-text">
            <strong>{t('models.envProvider', { env: status.resolvedApiKeyEnv ?? 'API key' })}</strong>
            <small>{t('models.inUse', { model: status.resolvedModel })}</small>
          </span>
        </div>
      )}
      <button
        type="button"
        className={`chat-model-provider-tab${activeProviderId === 'new' ? ' chat-model-provider-tab--active' : ''}`}
        onClick={() => onSelect('new')}
      >
        <PlusIcon size={13} />
        <span>{t('models.addProvider')}</span>
      </button>
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className={`chat-model-provider-tab${activeProviderId === provider.id ? ' chat-model-provider-tab--active' : ''}`}
          onClick={() => onSelect(provider.id)}
        >
          <span className={`chat-model-provider-status${provider.apiKeyPresent ? ' chat-model-provider-status--ok' : ''}`} />
          <span className="chat-model-provider-tab-text">
            <strong>{provider.name}</strong>
            <small>
              {status?.currentProvider === provider.id
                ? t('models.inUse', { model: status.resolvedModel })
                : t('models.providerCount', { count: provider.models.length })}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
};
