import type {
  CanvasModelProviderConfig,
  CanvasModelProviderType,
  CanvasModelStatus,
  CanvasProviderModel,
} from '../../types';

export interface ModelSelection {
  mode: 'auto' | 'model';
  providerId?: string;
  modelId?: string;
}

export interface UseCanvasModelsResult {
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

export const providerLabel = (type?: CanvasModelProviderType) => (
  type === 'claude' ? 'Claude' : 'OpenAI Compatible'
);

export const shortModelName = (model?: string) => {
  if (!model) return 'Auto';
  const parts = model.split('/');
  return parts[parts.length - 1] || model;
};
