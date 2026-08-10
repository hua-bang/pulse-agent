import type { CanvasProviderModel } from '../../types';

type ModelGroup = ReadonlyArray<CanvasProviderModel> | undefined;

export const mergeModels = (...groups: ModelGroup[]): CanvasProviderModel[] => {
  const models = new Map<string, CanvasProviderModel>();
  groups.forEach((group) => group?.forEach((model) => {
    const previous = models.get(model.id);
    models.set(model.id, model.name ? model : previous ?? model);
  }));
  return Array.from(models.values());
};

export const matchesModelQuery = (model: CanvasProviderModel, normalizedQuery: string): boolean => (
  model.id.toLowerCase().includes(normalizedQuery)
  || (model.name ?? '').toLowerCase().includes(normalizedQuery)
);
