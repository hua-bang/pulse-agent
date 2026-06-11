import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CanvasModelProviderConfig,
  CanvasModelProviderStatus,
  CanvasModelStatus,
  CanvasProviderModel,
} from '../../types';
import { TrashIcon } from '../icons';
import { ModelProviderFields } from './ModelProviderFields';
import { ModelProviderRail } from './ModelProviderRail';
import { useI18n } from '../../i18n';

interface ModelsSectionProps {
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

export const ModelsSection = ({
  status,
  error,
  onClose,
  onSaveProvider,
  onRemoveProvider,
  onFetchModels,
}: ModelsSectionProps) => {
  const { t } = useI18n();
  const providers = useMemo(() => status?.providers ?? [], [status?.providers]);
  const [activeProviderId, setActiveProviderId] = useState<string>('new');
  const [draft, setDraft] = useState<CanvasModelProviderConfig>(emptyProvider());
  const [manualModel, setManualModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [localError, setLocalError] = useState<string>();
  // Deleting a provider discards its saved API-key config with no undo, so
  // the trash button arms on the first click and deletes on the second.
  // Switching providers or pausing 3s disarms it.
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    setConfirmingRemove(false);
  }, [activeProviderId]);

  useEffect(() => {
    if (!confirmingRemove) return;
    const timer = window.setTimeout(() => setConfirmingRemove(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingRemove]);

  const activeProviderStatus = useMemo(
    () => providers.find((item) => item.id === activeProviderId),
    [providers, activeProviderId],
  );
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    if (!status) return;
    initializedRef.current = true;
    const initial = status.currentProvider ?? providers[0]?.id ?? 'new';
    setActiveProviderId(initial);
    const provider = providers.find((item) => item.id === initial);
    setDraft(providerToDraft(provider));
    setManualModel('');
    setLocalError(undefined);
  }, [status, providers]);

  const selectProvider = useCallback((providerId: string) => {
    setActiveProviderId(providerId);
    setDraft(providerToDraft(providers.find((item) => item.id === providerId)));
    setManualModel('');
    setLocalError(undefined);
  }, [providers]);

  const setDraftField = useCallback(<K extends keyof CanvasModelProviderConfig>(key: K, value: CanvasModelProviderConfig[K]) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === 'name' && !current.id) {
        next.id = inferProviderId(String(value)) || `provider-${Date.now().toString(36)}`;
      }
      return next;
    });
  }, []);

  const addManualModel = useCallback(() => {
    const id = manualModel.trim();
    if (!id) return;
    setDraft((current) => {
      const models = current.models ?? [];
      if (models.some((model) => model.id === id)) return current;
      return { ...current, models: [...models, { id }] };
    });
    setManualModel('');
  }, [manualModel]);

  const removeModel = useCallback((modelId: string) => {
    setDraft((current) => ({
      ...current,
      models: (current.models ?? []).filter((model) => model.id !== modelId),
    }));
  }, []);

  const fetchModels = useCallback(async () => {
    setFetching(true);
    setLocalError(undefined);
    try {
      const models = await onFetchModels(draft);
      setDraft((current) => ({ ...current, models }));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }, [draft, onFetchModels]);

  const save = useCallback(async () => {
    if (!draft.name.trim()) {
      setLocalError(t('models.nameRequired'));
      return;
    }
    if (!draft.id.trim()) {
      setLocalError(t('models.invalidId'));
      return;
    }
    if (!draft.base_url?.trim()) {
      setLocalError(t('models.baseUrlRequired'));
      return;
    }
    const hasSavedKey = Boolean(activeProviderStatus?.apiKeyPresent);
    if (!draft.api_key?.trim() && !hasSavedKey) {
      setLocalError(t('models.apiKeyRequired'));
      return;
    }

    setSaving(true);
    setLocalError(undefined);
    try {
      let fetchedModels: CanvasProviderModel[] = [];
      try {
        fetchedModels = await onFetchModels(draft);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLocalError(t('models.connectionTestFailed', { message: msg }));
        return;
      }

      const existingIds = new Set((draft.models ?? []).map((model) => model.id));
      const mergedModels = [
        ...(draft.models ?? []),
        ...fetchedModels.filter((model) => !existingIds.has(model.id)),
      ];
      const saved = await onSaveProvider({ ...draft, models: mergedModels });
      if (saved) {
        setActiveProviderId(draft.id);
        setDraft((current) => ({ ...current, models: mergedModels, api_key: '' }));
      }
    } finally {
      setSaving(false);
    }
  }, [draft, activeProviderStatus, onSaveProvider, onFetchModels, t]);

  return (
    <>
      <div className="chat-model-settings-body">
        <ModelProviderRail
          activeProviderId={activeProviderId}
          providers={providers}
          onSelect={selectProvider}
        />

        <div className="chat-model-settings-form">
          <div className="chat-model-settings-card chat-model-settings-card--intro">
            <div>
              <strong>
                {activeProviderId === 'new'
                  ? t('models.addTitle')
                  : t('models.editTitle', { name: draft.name || t('models.providerFallback') })}
              </strong>
              <p>{t('models.intro')}</p>
            </div>
            {activeProviderId !== 'new' && (
              <button
                type="button"
                className={`chat-model-danger-btn${confirmingRemove ? ' chat-model-danger-btn--confirm' : ''}`}
                title={t('models.removeProvider')}
                aria-label={t('models.removeProvider')}
                onClick={() => {
                  if (!confirmingRemove) {
                    setConfirmingRemove(true);
                    return;
                  }
                  setConfirmingRemove(false);
                  void onRemoveProvider(activeProviderId);
                }}
              >
                <TrashIcon />
                {confirmingRemove && <span>{t('models.removeProviderConfirm')}</span>}
              </button>
            )}
          </div>

          {(localError || error) && <div className="chat-model-settings-error">{localError || error}</div>}

          <ModelProviderFields
            activeProviderId={activeProviderId}
            activeProviderStatus={activeProviderStatus}
            addManualModel={addManualModel}
            draft={draft}
            fetching={fetching}
            fetchModels={fetchModels}
            manualModel={manualModel}
            removeModel={removeModel}
            setDraftField={setDraftField}
            setManualModel={setManualModel}
          />
        </div>
      </div>

      <div className="chat-model-settings-footer">
        <span>{status?.path}</span>
        <button type="button" className="chat-model-secondary-btn" onClick={onClose}>{t('models.cancel')}</button>
        <button type="button" className="chat-model-primary-btn" onClick={() => void save()} disabled={saving}>
          {saving ? t('models.testing') : t('models.testAndSave')}
        </button>
      </div>
    </>
  );
};
