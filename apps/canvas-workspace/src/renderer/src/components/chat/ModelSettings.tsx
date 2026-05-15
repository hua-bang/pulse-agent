import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  CanvasModelProviderConfig,
  CanvasModelProviderStatus,
  CanvasModelProviderType,
  CanvasModelStatus,
  CanvasProviderModel,
} from '../../types';
import { CheckIcon, PlusIcon, RefreshIcon, TrashIcon } from '../icons';

interface ModelSelection {
  mode: 'auto' | 'model';
  providerId?: string;
  modelId?: string;
}

interface UseCanvasModelsResult {
  status?: CanvasModelStatus;
  loading: boolean;
  error?: string;
  selection: ModelSelection;
  selectedLabel: string;
  refresh: () => Promise<void>;
  selectAuto: () => Promise<void>;
  selectModel: (providerId: string, modelId: string) => Promise<void>;
  upsertProvider: (provider: CanvasModelProviderConfig) => Promise<CanvasModelStatus | undefined>;
  removeProvider: (providerId: string) => Promise<void>;
  fetchModels: (provider: CanvasModelProviderConfig) => Promise<CanvasProviderModel[]>;
}

const providerLabel = (type?: CanvasModelProviderType) => type === 'claude' ? 'Claude' : 'OpenAI Compatible';

const shortModelName = (model?: string) => {
  if (!model) return 'Auto';
  const parts = model.split('/');
  return parts[parts.length - 1] || model;
};

export function useCanvasModels(): UseCanvasModelsResult {
  const [status, setStatus] = useState<CanvasModelStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const api = window.canvasWorkspace?.model;
    if (!api) return;
    setLoading(true);
    const result = await api.status();
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? 'Failed to load model settings');
      return;
    }
    setError(undefined);
    setStatus(result.status);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selection = useMemo<ModelSelection>(() => {
    if (status?.currentProvider && status.currentModel) {
      return { mode: 'model', providerId: status.currentProvider, modelId: status.currentModel };
    }
    return { mode: 'auto' };
  }, [status]);

  const selectedLabel = useMemo(() => {
    if (selection.mode === 'auto') return status?.apiKeyPresent ? 'Auto' : 'Auto';
    return shortModelName(selection.modelId);
  }, [selection, status?.apiKeyPresent]);

  const selectAuto = useCallback(async () => {
    const result = await window.canvasWorkspace.model.setCurrent(undefined, undefined);
    if (!result.ok) {
      setError(result.error ?? 'Failed to switch model');
      return;
    }
    setError(undefined);
    setStatus(result.status);
  }, []);

  const selectModel = useCallback(async (providerId: string, modelId: string) => {
    const result = await window.canvasWorkspace.model.setCurrent(modelId, providerId);
    if (!result.ok) {
      setError(result.error ?? 'Failed to switch model');
      return;
    }
    setError(undefined);
    setStatus(result.status);
  }, []);

  const upsertProvider = useCallback(async (provider: CanvasModelProviderConfig) => {
    const result = await window.canvasWorkspace.model.upsertProvider(provider);
    if (!result.ok) {
      setError(result.error ?? 'Failed to save provider');
      return undefined;
    }
    setError(undefined);
    setStatus(result.status);
    return result.status;
  }, []);

  const removeProvider = useCallback(async (providerId: string) => {
    const result = await window.canvasWorkspace.model.removeProvider(providerId);
    if (!result.ok) {
      setError(result.error ?? 'Failed to remove provider');
      return;
    }
    setError(undefined);
    setStatus(result.status);
  }, []);

  const fetchModels = useCallback(async (provider: CanvasModelProviderConfig) => {
    const result = await window.canvasWorkspace.model.fetchModels(undefined, provider);
    if (!result.ok) throw new Error(result.error ?? 'Failed to fetch models');
    return result.models ?? [];
  }, []);

  return {
    status,
    loading,
    error,
    selection,
    selectedLabel,
    refresh,
    selectAuto,
    selectModel,
    upsertProvider,
    removeProvider,
    fetchModels,
  };
}

interface ModelSwitcherProps {
  status?: CanvasModelStatus;
  selection: ModelSelection;
  label: string;
  onSelectAuto: () => Promise<void>;
  onSelectModel: (providerId: string, modelId: string) => Promise<void>;
  onOpenSettings: () => void;
}

const MODEL_MENU_WIDTH = 292;
const MODEL_MENU_GAP = 8;
const MODEL_MENU_VIEWPORT_MARGIN = 12;

export const ModelSwitcher = ({
  status,
  selection,
  label,
  onSelectAuto,
  onSelectModel,
  onOpenSettings,
}: ModelSwitcherProps) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const menuEl = menuRef.current;
    const menuHeight = menuEl?.offsetHeight ?? 360;
    const menuWidth = menuEl?.offsetWidth ?? MODEL_MENU_WIDTH;

    // Anchor menu bottom to MODEL_MENU_GAP above the trigger top.
    let top = rect.top - menuHeight - MODEL_MENU_GAP;
    if (top < MODEL_MENU_VIEWPORT_MARGIN) {
      // Fall back to opening below when there isn't enough room above.
      const below = rect.bottom + MODEL_MENU_GAP;
      top = Math.min(below, viewportHeight - menuHeight - MODEL_MENU_VIEWPORT_MARGIN);
      top = Math.max(top, MODEL_MENU_VIEWPORT_MARGIN);
    }

    // Right-align to the trigger's right edge, clamped to viewport.
    let left = rect.right - menuWidth;
    left = Math.min(left, viewportWidth - menuWidth - MODEL_MENU_VIEWPORT_MARGIN);
    left = Math.max(left, MODEL_MENU_VIEWPORT_MARGIN);

    setMenuPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onResize = () => updateMenuPosition();
    const onScroll = () => updateMenuPosition();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onResize);
    // capture so we react to scrolls in any ancestor scroll container.
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, updateMenuPosition]);

  const providers = useMemo(() => status?.providers ?? [], [status?.providers]);
  const hasConfiguredModels = providers.some(provider => provider.models.length > 0);

  return (
    <div className="chat-model-switcher">
      <button
        ref={triggerRef}
        type="button"
        className={`chat-model-switcher-btn${!status?.apiKeyPresent ? ' chat-model-switcher-btn--warning' : ''}`}
        onClick={() => setOpen(value => !value)}
        title="选择本次使用的模型"
        aria-label="选择模型"
      >
        <span className="chat-model-switcher-dot" />
        <span className="chat-model-switcher-label">{label}</span>
        <span className="chat-model-switcher-chevron" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2.75 4L5 6.25L7.25 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="chat-model-menu"
          style={{
            top: menuPosition?.top ?? -9999,
            left: menuPosition?.left ?? -9999,
            visibility: menuPosition ? 'visible' : 'hidden',
          }}
        >
          <div className="chat-model-menu-label">Use model</div>
          <button
            type="button"
            className={`chat-model-menu-item${selection.mode === 'auto' ? ' chat-model-menu-item--active' : ''}`}
            onClick={() => {
              setOpen(false);
              void onSelectAuto();
            }}
          >
            <span className="chat-model-menu-check">{selection.mode === 'auto' ? <CheckIcon /> : null}</span>
            <span className="chat-model-menu-main">
              <span className="chat-model-menu-title">Auto</span>
              <span className="chat-model-menu-subtitle">自动使用当前默认配置</span>
            </span>
          </button>
          {providers.length > 0 && <div className="chat-model-menu-divider" />}
          {providers.map(provider => (
            <div key={provider.id} className="chat-model-menu-provider">
              <div className="chat-model-menu-provider-head">
                <span>{provider.name}</span>
                <span>{providerLabel(provider.provider_type)}</span>
              </div>
              {provider.models.length > 0 ? provider.models.map(model => {
                const active = selection.mode === 'model' && selection.providerId === provider.id && selection.modelId === model.id;
                return (
                  <button
                    key={`${provider.id}:${model.id}`}
                    type="button"
                    className={`chat-model-menu-item chat-model-menu-item--model${active ? ' chat-model-menu-item--active' : ''}`}
                    onClick={() => {
                      setOpen(false);
                      void onSelectModel(provider.id, model.id);
                    }}
                  >
                    <span className="chat-model-menu-check">{active ? <CheckIcon /> : null}</span>
                    <span className="chat-model-menu-main">
                      <span className="chat-model-menu-title">{model.name ?? model.id}</span>
                      <span className="chat-model-menu-subtitle">{model.id}</span>
                    </span>
                  </button>
                );
              }) : (
                <div className="chat-model-menu-empty">No models yet</div>
              )}
            </div>
          ))}
          {!hasConfiguredModels && (
            <div className="chat-model-menu-hint">
              配置 API Key / Base URL 后可拉取模型，也可以手动添加。
            </div>
          )}
          <div className="chat-model-menu-divider" />
          <button
            type="button"
            className="chat-model-menu-action"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            Manage providers…
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
};

interface ModelSettingsDrawerProps {
  open: boolean;
  status?: CanvasModelStatus;
  error?: string;
  onClose: () => void;
  onSaveProvider: (provider: CanvasModelProviderConfig) => Promise<CanvasModelStatus | undefined>;
  onRemoveProvider: (providerId: string) => Promise<void>;
  onFetchModels: (provider: CanvasModelProviderConfig) => Promise<CanvasProviderModel[]>;
}

const emptyProvider = (): CanvasModelProviderConfig => ({
  id: '',
  name: '',
  provider_type: 'openai',
  base_url: '',
  api_key: '',
  models: [],
});

const providerToDraft = (provider?: CanvasModelProviderStatus): CanvasModelProviderConfig => {
  if (!provider) return emptyProvider();
  return {
    id: provider.id,
    name: provider.name,
    provider_type: provider.provider_type,
    base_url: provider.base_url ?? '',
    api_key: '',
    api_key_env: provider.api_key_env,
    headers: provider.headers,
    models: provider.models,
  };
};

const inferProviderId = (name: string) => name
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '');

interface ApiKeyStatusHintProps {
  status?: CanvasModelProviderStatus;
  drafting: boolean;
}

const ApiKeyStatusHint = ({ status, drafting }: ApiKeyStatusHintProps) => {
  if (drafting) {
    return <span className="chat-model-field-hint chat-model-field-hint--info">将用输入的新 Key 覆盖已保存的值</span>;
  }
  if (!status) return null;
  if (status.apiKeyPresent) {
    const length = status.apiKeyLength;
    const lengthSuffix = typeof length === 'number' && length > 0 ? `（共 ${length} 字符）` : '';
    const source = status.api_key_env && !length ? `（来自环境变量 ${status.api_key_env}）` : '';
    return (
      <span className="chat-model-field-hint chat-model-field-hint--ok">
        ✓ 已保存{lengthSuffix}{source}
      </span>
    );
  }
  return <span className="chat-model-field-hint chat-model-field-hint--warn">未设置 API Key — 调用模型时会失败</span>;
};

export const ModelSettingsDrawer = ({
  open,
  status,
  error,
  onClose,
  onSaveProvider,
  onRemoveProvider,
  onFetchModels,
}: ModelSettingsDrawerProps) => {
  const providers = useMemo(() => status?.providers ?? [], [status?.providers]);
  const [activeProviderId, setActiveProviderId] = useState<string>('new');
  const [draft, setDraft] = useState<CanvasModelProviderConfig>(emptyProvider());
  const [manualModel, setManualModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [localError, setLocalError] = useState<string>();

  const activeProviderStatus = useMemo(
    () => providers.find(item => item.id === activeProviderId),
    [providers, activeProviderId],
  );

  const initializedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    // Wait for status to load before picking the initial tab, otherwise we
    // default to "Add provider" before the user's providers come in. Once
    // initialized, ignore later changes to providers (e.g. after save) so
    // the active tab doesn't get yanked back to the first one.
    if (!status) return;
    initializedRef.current = true;
    const initial = status.currentProvider ?? providers[0]?.id ?? 'new';
    setActiveProviderId(initial);
    const provider = providers.find(item => item.id === initial);
    setDraft(providerToDraft(provider));
    setManualModel('');
    setLocalError(undefined);
  }, [open, status, providers]);

  const selectProvider = useCallback((providerId: string) => {
    setActiveProviderId(providerId);
    setDraft(providerToDraft(providers.find(item => item.id === providerId)));
    setManualModel('');
    setLocalError(undefined);
  }, [providers]);

  const setDraftField = useCallback(<K extends keyof CanvasModelProviderConfig>(key: K, value: CanvasModelProviderConfig[K]) => {
    setDraft(current => {
      const next = { ...current, [key]: value };
      if (key === 'name' && !current.id) {
        // Fall back to a timestamp-based id when the name slugs to empty
        // (e.g. all-CJK names like "深度求索"). Internal-only — the user
        // never sees this since the id field is no longer in the UI.
        next.id = inferProviderId(String(value)) || `provider-${Date.now().toString(36)}`;
      }
      return next;
    });
  }, []);

  const addManualModel = useCallback(() => {
    const id = manualModel.trim();
    if (!id) return;
    setDraft(current => {
      const models = current.models ?? [];
      if (models.some(model => model.id === id)) return current;
      return { ...current, models: [...models, { id }] };
    });
    setManualModel('');
  }, [manualModel]);

  const removeModel = useCallback((modelId: string) => {
    setDraft(current => ({
      ...current,
      models: (current.models ?? []).filter(model => model.id !== modelId),
    }));
  }, []);

  const fetchModels = useCallback(async () => {
    setFetching(true);
    setLocalError(undefined);
    try {
      const models = await onFetchModels(draft);
      setDraft(current => ({ ...current, models }));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }, [draft, onFetchModels]);

  const save = useCallback(async () => {
    if (!draft.name.trim()) {
      setLocalError('请填写 Provider name');
      return;
    }
    if (!draft.id.trim()) {
      setLocalError('Provider name 无法生成合法的 id，换个名字试试');
      return;
    }
    if (!draft.base_url?.trim()) {
      setLocalError('请填写 API URL / Base URL');
      return;
    }
    const hasSavedKey = Boolean(activeProviderStatus?.apiKeyPresent);
    if (!draft.api_key?.trim() && !hasSavedKey) {
      setLocalError('请填写 API Key');
      return;
    }

    setSaving(true);
    setLocalError(undefined);
    try {
      // Connection test: hits the provider's /models endpoint using the
      // currently-selected protocol. This catches the most common silent
      // failure — base URL / api key / protocol mismatch — before the
      // user discovers it during chat as a "No output generated" error.
      let fetchedModels: CanvasProviderModel[] = [];
      try {
        fetchedModels = await onFetchModels(draft);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLocalError(`连接测试失败：${msg}`);
        return;
      }

      const existingIds = new Set((draft.models ?? []).map(m => m.id));
      const mergedModels = [
        ...(draft.models ?? []),
        ...fetchedModels.filter(m => !existingIds.has(m.id)),
      ];
      const payload: CanvasModelProviderConfig = { ...draft, models: mergedModels };
      const saved = await onSaveProvider(payload);
      if (saved) {
        setActiveProviderId(draft.id);
        setDraft(current => ({ ...current, models: mergedModels, api_key: '' }));
      }
    } finally {
      setSaving(false);
    }
  }, [draft, activeProviderStatus, onSaveProvider, onFetchModels]);

  if (!open) return null;

  return createPortal(
    <div className="chat-model-settings-backdrop" onMouseDown={onClose}>
      <aside className="chat-model-settings" onMouseDown={event => event.stopPropagation()} aria-label="AI model settings">
        <div className="chat-model-settings-header">
          <div>
            <div className="chat-model-settings-kicker">AI Settings</div>
            <h2>Models & Providers</h2>
          </div>
          <button type="button" className="chat-model-settings-close" onClick={onClose} aria-label="关闭模型设置">×</button>
        </div>

        <div className="chat-model-settings-body">
          <div className="chat-model-provider-rail">
            <button
              type="button"
              className={`chat-model-provider-tab${activeProviderId === 'new' ? ' chat-model-provider-tab--active' : ''}`}
              onClick={() => selectProvider('new')}
            >
              <PlusIcon size={13} />
              <span>Add provider</span>
            </button>
            {providers.map(provider => (
              <button
                key={provider.id}
                type="button"
                className={`chat-model-provider-tab${activeProviderId === provider.id ? ' chat-model-provider-tab--active' : ''}`}
                onClick={() => selectProvider(provider.id)}
              >
                <span className={`chat-model-provider-status${provider.apiKeyPresent ? ' chat-model-provider-status--ok' : ''}`} />
                <span className="chat-model-provider-tab-text">
                  <strong>{provider.name}</strong>
                  <small>{provider.models.length} models</small>
                </span>
              </button>
            ))}
          </div>

          <div className="chat-model-settings-form">
            <div className="chat-model-settings-card chat-model-settings-card--intro">
              <div>
                <strong>{activeProviderId === 'new' ? 'Add a model provider' : `Edit ${draft.name || 'provider'}`}</strong>
                <p>填好协议、URL、API Key，点"测试并保存"会先连接 provider 拉取可用模型，确认 URL + Key + 协议都对得上后再落盘。</p>
              </div>
              {activeProviderId !== 'new' && (
                <button
                  type="button"
                  className="chat-model-danger-btn"
                  onClick={() => void onRemoveProvider(activeProviderId)}
                >
                  <TrashIcon />
                </button>
              )}
            </div>

            {(localError || error) && <div className="chat-model-settings-error">{localError || error}</div>}

            <label className="chat-model-field">
              <span>Provider name</span>
              <input value={draft.name} placeholder="DeepSeek / OpenRouter / Local" onChange={event => setDraftField('name', event.target.value)} />
            </label>

            <div className="chat-model-field">
              <span>协议 / Protocol</span>
              <div
                role="radiogroup"
                aria-label="协议格式"
                className="chat-model-protocol-toggle"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={(draft.provider_type ?? 'openai') === 'openai'}
                  className={`chat-model-protocol-option${(draft.provider_type ?? 'openai') === 'openai' ? ' chat-model-protocol-option--active' : ''}`}
                  onClick={() => setDraftField('provider_type', 'openai')}
                >
                  <span className="chat-model-protocol-title">OpenAI 兼容</span>
                  <span className="chat-model-protocol-sub">/v1/chat/completions</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.provider_type === 'claude'}
                  className={`chat-model-protocol-option${draft.provider_type === 'claude' ? ' chat-model-protocol-option--active' : ''}`}
                  onClick={() => setDraftField('provider_type', 'claude')}
                >
                  <span className="chat-model-protocol-title">Claude (Anthropic)</span>
                  <span className="chat-model-protocol-sub">/v1/messages</span>
                </button>
              </div>
            </div>

            <label className="chat-model-field">
              <span>API URL / Base URL</span>
              <input
                value={draft.base_url ?? ''}
                placeholder={draft.provider_type === 'claude' ? 'https://api.anthropic.com/v1' : 'https://api.deepseek.com/v1'}
                onChange={event => setDraftField('base_url', event.target.value)}
              />
            </label>

            <label className="chat-model-field">
              <span>API Key</span>
              <input
                value={draft.api_key ?? ''}
                type="password"
                placeholder={activeProviderStatus?.apiKeyPresent ? '留空则保留已保存的 API Key' : '请输入 API Key'}
                onChange={event => setDraftField('api_key', event.target.value)}
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
                  onChange={event => setManualModel(event.target.value)}
                  onKeyDown={event => {
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
              {(draft.models ?? []).length > 0 ? draft.models?.map(model => (
                <span key={model.id} className="chat-model-chip">
                  {model.name ?? model.id}
                  <button type="button" onClick={() => removeModel(model.id)} aria-label={`Remove ${model.id}`}>×</button>
                </span>
              )) : (
                <div className="chat-model-settings-empty">还没有模型。可以 Fetch Models，或手动输入 model id 后 Add。</div>
              )}
            </div>
          </div>
        </div>

        <div className="chat-model-settings-footer">
          <span>{status?.path}</span>
          <button type="button" className="chat-model-secondary-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="chat-model-primary-btn" onClick={() => void save()} disabled={saving}>
            {saving ? '测试中…' : '测试并保存'}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
};
