import type { CanvasModelProviderType, CanvasProviderModel } from '../types';

type ModelGroup = ReadonlyArray<CanvasProviderModel> | undefined;

export const mergeModels = (...groups: ModelGroup[]): CanvasProviderModel[] => {
  const models = new Map<string, CanvasProviderModel>();
  groups.forEach((group) => group?.forEach((model) => {
    // Later groups win, but never erase a name or window an earlier one knew.
    const previous = models.get(model.id);
    const merged: CanvasProviderModel = { ...previous, ...model };
    const name = model.name ?? previous?.name;
    const contextWindow = model.context_window ?? previous?.context_window;
    if (name) merged.name = name; else delete merged.name;
    if (contextWindow) merged.context_window = contextWindow; else delete merged.context_window;
    models.set(model.id, merged);
  }));
  return Array.from(models.values());
};

export const matchesModelQuery = (model: CanvasProviderModel, normalizedQuery: string): boolean => (
  model.id.toLowerCase().includes(normalizedQuery)
  || (model.name ?? '').toLowerCase().includes(normalizedQuery)
);

export const providerLabel = (type?: CanvasModelProviderType) => (
  type === 'claude' ? 'Claude' : 'OpenAI Compatible'
);

export const shortModelName = (model: string | undefined, fallback: string) => {
  if (!model) return fallback;
  const parts = model.split('/');
  return parts[parts.length - 1] || model;
};
