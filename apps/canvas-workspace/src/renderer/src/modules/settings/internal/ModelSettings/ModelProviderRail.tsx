import type { ReactNode } from 'react';
import type { CanvasModelProviderStatus, CanvasModelStatus } from '../../../../types';
import { PlusIcon } from '../../../../components/icons';
import { useI18n } from '../../../../i18n';

/** Rail id of the read-only env-key row; never a saved provider id. */
export const ENV_PROVIDER_ID = '__env__';

export const isEnvProviderInUse = (status?: CanvasModelStatus): status is CanvasModelStatus =>
  !!status && !status.currentProvider && status.apiKeyPresent;

interface ProviderRailProps {
  activeProviderId: string;
  providers: CanvasModelProviderStatus[];
  /** The model chat actually resolves to; marks the provider in use. */
  status?: CanvasModelStatus;
  onSelect: (providerId: string) => void;
}

const RailTab = ({
  id,
  activeProviderId,
  className,
  title,
  onSelect,
  children,
}: {
  id: string;
  activeProviderId: string;
  className?: string;
  title?: string;
  onSelect: (providerId: string) => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    className={[
      'chat-model-provider-tab',
      className,
      activeProviderId === id && 'chat-model-provider-tab--active',
    ].filter(Boolean).join(' ')}
    title={title}
    onClick={() => onSelect(id)}
  >
    {children}
  </button>
);

export const ModelProviderRail = ({
  activeProviderId,
  providers,
  status,
  onSelect,
}: ProviderRailProps) => {
  const { t } = useI18n();
  // With no saved provider selected, chat runs on an env key. Show that
  // setup as its own row, or the page reads as "nothing configured".
  const envInUse = isEnvProviderInUse(status);

  return (
    <div className="chat-model-provider-rail">
      {envInUse && (
        <RailTab
          id={ENV_PROVIDER_ID}
          activeProviderId={activeProviderId}
          className="chat-model-provider-tab--env"
          title={status.resolvedBaseURL}
          onSelect={onSelect}
        >
          <span className="chat-model-provider-status chat-model-provider-status--ok" />
          <span className="chat-model-provider-tab-text">
            <strong>{t('models.envProvider', { env: status.resolvedApiKeyEnv ?? 'API key' })}</strong>
            <small>{t('models.inUse', { model: status.resolvedModel })}</small>
          </span>
        </RailTab>
      )}
      <RailTab id="new" activeProviderId={activeProviderId} onSelect={onSelect}>
        <PlusIcon size={13} />
        <span>{t('models.addProvider')}</span>
      </RailTab>
      {providers.map((provider) => (
        <RailTab key={provider.id} id={provider.id} activeProviderId={activeProviderId} onSelect={onSelect}>
          <span className={`chat-model-provider-status${provider.apiKeyPresent ? ' chat-model-provider-status--ok' : ''}`} />
          <span className="chat-model-provider-tab-text">
            <strong>{provider.name}</strong>
            <small>
              {status?.currentProvider === provider.id
                ? t('models.inUse', { model: status.resolvedModel })
                : t('models.providerCount', { count: provider.models.length })}
            </small>
          </span>
        </RailTab>
      ))}
    </div>
  );
};
