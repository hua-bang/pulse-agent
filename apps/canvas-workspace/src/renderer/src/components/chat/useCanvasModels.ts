import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CanvasModelProviderConfig } from '../../types';
import type { ModelSelection, UseCanvasModelsResult } from './modelSettingsTypes';
import { shortModelName } from './modelSettingsTypes';

const MODEL_SETTINGS_CHANGED_EVENT = 'canvas-workspace:model-settings-changed';

function broadcastModelStatus(status?: UseCanvasModelsResult['status']): void {
  window.dispatchEvent(new CustomEvent(MODEL_SETTINGS_CHANGED_EVENT, { detail: status }));
}

export function useCanvasModels(): UseCanvasModelsResult {
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
      setError(result.error ?? 'Failed to load model settings');
      return;
    }
    setError(undefined);
    setStatus(result.status);
  }, []);

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
    broadcastModelStatus(result.status);
  }, []);

  const selectModel = useCallback(async (providerId: string, modelId: string) => {
    const result = await window.canvasWorkspace.model.setCurrent(modelId, providerId);
    if (!result.ok) {
      setError(result.error ?? 'Failed to switch model');
      return;
    }
    setError(undefined);
    setStatus(result.status);
    broadcastModelStatus(result.status);
  }, []);

  const upsertProvider = useCallback(async (provider: CanvasModelProviderConfig) => {
    const result = await window.canvasWorkspace.model.upsertProvider(provider);
    if (!result.ok) {
      setError(result.error ?? 'Failed to save provider');
      return undefined;
    }
    setError(undefined);
    setStatus(result.status);
    broadcastModelStatus(result.status);
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
    broadcastModelStatus(result.status);
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
