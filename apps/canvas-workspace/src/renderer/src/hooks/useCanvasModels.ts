import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CanvasModelProviderConfig,
  ModelSelection,
  UseCanvasModelsResult,
} from '../types';
import { useI18n } from '../i18n';
import { shortModelName } from '../utils/modelCatalog';

const MODEL_SETTINGS_CHANGED_EVENT = 'canvas-workspace:model-settings-changed';

function broadcastModelStatus(status?: UseCanvasModelsResult['status']): void {
  window.dispatchEvent(new CustomEvent(MODEL_SETTINGS_CHANGED_EVENT, { detail: status }));
}

export function useCanvasModels(): UseCanvasModelsResult {
  const { t } = useI18n();
  const [status, setStatus] = useState<UseCanvasModelsResult['status']>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const api = window.canvasWorkspace?.model;
    if (!api) return;
    setLoading(true);
    const result = await api.status();
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? t('models.loadSettingsFailed'));
      return;
    }
    setError(undefined);
    setStatus(result.status);
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleModelSettingsChanged = (event: Event) => {
      const nextStatus = (event as CustomEvent<UseCanvasModelsResult['status']>).detail;
      if (nextStatus) {
        setError(undefined);
        setLoading(false);
        setStatus(nextStatus);
        return;
      }
      void refresh();
    };
    window.addEventListener(MODEL_SETTINGS_CHANGED_EVENT, handleModelSettingsChanged);
    return () => window.removeEventListener(MODEL_SETTINGS_CHANGED_EVENT, handleModelSettingsChanged);
  }, [refresh]);

  const selection = useMemo<ModelSelection>(() => {
    if (status?.currentProvider && status.currentModel) {
      return { mode: 'model', providerId: status.currentProvider, modelId: status.currentModel };
    }
    return { mode: 'auto' };
  }, [status]);

  const selectedLabel = useMemo(() => {
    if (selection.mode === 'auto') return t('models.auto');
    return shortModelName(selection.modelId, t('models.auto'));
  }, [selection, t]);

  const selectModel = useCallback(async (providerId: string, modelId: string) => {
    const result = await window.canvasWorkspace.model.setCurrent(modelId, providerId);
    if (!result.ok) {
      const message = result.error ?? t('models.switchFailed');
      setError(message);
      throw new Error(message);
    }
    setError(undefined);
    setStatus(result.status);
    broadcastModelStatus(result.status);
  }, [t]);

  const upsertProvider = useCallback(async (provider: CanvasModelProviderConfig) => {
    const result = await window.canvasWorkspace.model.upsertProvider(provider);
    if (!result.ok) {
      setError(result.error ?? t('models.saveProviderFailed'));
      return undefined;
    }
    setError(undefined);
    setStatus(result.status);
    broadcastModelStatus(result.status);
    return result.status;
  }, [t]);

  const removeProvider = useCallback(async (providerId: string) => {
    const result = await window.canvasWorkspace.model.removeProvider(providerId);
    if (!result.ok) {
      setError(result.error ?? t('models.removeProviderFailed'));
      return;
    }
    setError(undefined);
    setStatus(result.status);
    broadcastModelStatus(result.status);
  }, [t]);

  const fetchModels = useCallback(async (provider: CanvasModelProviderConfig) => {
    const result = await window.canvasWorkspace.model.fetchModels(undefined, provider);
    if (!result.ok) throw new Error(result.error ?? t('models.fetchFailed'));
    return result.models ?? [];
  }, [t]);

  return {
    status,
    loading,
    error,
    selection,
    selectedLabel,
    refresh,
    selectModel,
    upsertProvider,
    removeProvider,
    fetchModels,
  };
}
