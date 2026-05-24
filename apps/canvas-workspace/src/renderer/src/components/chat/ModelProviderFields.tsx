import type { CanvasModelProviderConfig, CanvasModelProviderStatus } from '../../types';
import { RefreshIcon } from '../icons';
import { ApiKeyStatusHint } from './ApiKeyStatusHint';

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
}: ProviderFieldsProps) => (
  <>
    <label className="chat-model-field">
      <span>Provider name</span>
      <input value={draft.name} placeholder="DeepSeek / OpenRouter / Local" onChange={(event) => setDraftField('name', event.target.value)} />
    </label>

    <div className="chat-model-field">
      <span>协议 / Protocol</span>
      <div role="radiogroup" aria-label="协议格式" className="chat-model-protocol-toggle">
        <ProtocolOption
          active={(draft.provider_type ?? 'openai') === 'openai'}
          title="OpenAI 兼容"
          subtitle="/v1/chat/completions"
          onClick={() => setDraftField('provider_type', 'openai')}
        />
        <ProtocolOption
          active={draft.provider_type === 'claude'}
          title="Claude (Anthropic)"
          subtitle="/v1/messages"
          onClick={() => setDraftField('provider_type', 'claude')}
        />
      </div>
    </div>

    <label className="chat-model-field">
      <span>API URL / Base URL</span>
      <input
        value={draft.base_url ?? ''}
        placeholder={draft.provider_type === 'claude' ? 'https://api.anthropic.com/v1' : 'https://api.deepseek.com/v1'}
        onChange={(event) => setDraftField('base_url', event.target.value)}
      />
    </label>

    <label className="chat-model-field">
      <span>API Key</span>
      <input
        value={draft.api_key ?? ''}
        type="password"
        placeholder={activeProviderStatus?.apiKeyPresent ? '留空则保留已保存的 API Key' : '请输入 API Key'}
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
        <span>Models</span>
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
      <button type="button" className="chat-model-secondary-btn" onClick={addManualModel}>Add</button>
      <button type="button" className="chat-model-secondary-btn" onClick={() => void fetchModels()} disabled={fetching}>
        <RefreshIcon />
        {fetching ? 'Fetching' : 'Fetch'}
      </button>
    </div>

    <div className="chat-model-model-list">
      {(draft.models ?? []).length > 0 ? draft.models?.map((model) => (
        <span key={model.id} className="chat-model-chip">
          {model.name ?? model.id}
          <button type="button" onClick={() => removeModel(model.id)} aria-label={`Remove ${model.id}`}>×</button>
        </span>
      )) : (
        <div className="chat-model-settings-empty">还没有模型。可以 Fetch Models，或手动输入 model id 后 Add。</div>
      )}
    </div>
  </>
);

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
