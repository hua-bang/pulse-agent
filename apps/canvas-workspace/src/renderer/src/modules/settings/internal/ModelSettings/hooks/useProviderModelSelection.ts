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

  return {
    availableModels,
    mergeModelCatalog,
    resetModelCatalog,
    toggleModel,
  };
};
