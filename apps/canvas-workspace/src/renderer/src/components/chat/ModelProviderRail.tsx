import type { CanvasModelProviderStatus } from '../../types';
import { PlusIcon } from '../icons';

interface ProviderRailProps {
  activeProviderId: string;
  providers: CanvasModelProviderStatus[];
  onSelect: (providerId: string) => void;
}

export const ModelProviderRail = ({
  activeProviderId,
  providers,
  onSelect,
}: ProviderRailProps) => (
  <div className="chat-model-provider-rail">
    <button
      type="button"
      className={`chat-model-provider-tab${activeProviderId === 'new' ? ' chat-model-provider-tab--active' : ''}`}
      onClick={() => onSelect('new')}
    >
      <PlusIcon size={13} />
      <span>Add provider</span>
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
          <small>{provider.models.length} models</small>
        </span>
      </button>
    ))}
  </div>
);
