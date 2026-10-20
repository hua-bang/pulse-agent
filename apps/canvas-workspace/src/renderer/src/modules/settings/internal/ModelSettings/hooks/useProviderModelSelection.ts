import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { CanvasModelProviderConfig, CanvasProviderModel } from '../../../../../types';
import { mergeModels } from '../../../../../utils/modelCatalog';

type ModelGroup = ReadonlyArray<CanvasProviderModel> | undefined;

export const useProviderModelSelection = (
  setDraft: Dispatch<SetStateAction<CanvasModelProviderConfig>>,
) => {
  const [availableModels, setAvailableModels] = useState<CanvasProviderModel[]>([]);

  const resetModelCatalog = useCallback((models?: ReadonlyArray<CanvasProviderModel>) => {
    setAvailableModels(models ? [...models] : []);
  }, []);

  const mergeModelCatalog = useCallback((...groups: ModelGroup[]) => {
    setAvailableModels((current) => mergeModels(current, ...groups));
  }, []);

  const toggleModel = useCallback((model: CanvasProviderModel, selected: boolean) => {
    setDraft((current) => {
      const models = current.models ?? [];
      return {
        ...current,
        models: selected
          ? mergeModels(models, [model])
          : models.filter((item) => item.id !== model.id),
      };
    });
  }, [setDraft]);

  const setModelsSelected = useCallback((targets: ReadonlyArray<CanvasProviderModel>, selected: boolean) => {
    const ids = new Set(targets.map((model) => model.id));
    setDraft((current) => ({
      ...current,
      models: selected
        ? mergeModels(current.models, targets)
        : (current.models ?? []).filter((item) => !ids.has(item.id)),
    }));
  }, [setDraft]);

  /** Set or clear (`undefined`) the window the user chose for one model. */
  const setModelContextWindow = useCallback((modelId: string, tokens: number | undefined) => {
    const apply = (models: CanvasProviderModel[]) => models.map((model) => {
      if (model.id !== modelId) return model;
      const next = { ...model, custom_context_window: tokens };
      if (!tokens) delete next.custom_context_window;
      return next;
    });
    setAvailableModels(apply);
    setDraft((current) => ({ ...current, models: apply(current.models ?? []) }));
  }, [setDraft]);

  return {
    availableModels,
    setModelContextWindow,
    setModelsSelected,
    mergeModelCatalog,
    resetModelCatalog,
    toggleModel,
  };
};
