import type {
  CanvasModelConfig,
  CanvasModelOption,
  CanvasModelProviderConfig,
  CanvasModelStatus,
  CanvasProviderModel,
  PromptProfile,
  PromptProfileStatus,
} from '../../../shared/model-config';

export type * from '../../../shared/model-config';

export interface PromptProfileApi {
  get: () => Promise<{ ok: boolean; profile?: PromptProfileStatus; error?: string }>;
  save: (
    profile: Partial<PromptProfile>,
  ) => Promise<{ ok: boolean; profile?: PromptProfileStatus; error?: string }>;
  reset: () => Promise<{ ok: boolean; profile?: PromptProfileStatus; error?: string }>;
}

export interface CanvasModelApi {
  status: () => Promise<{ ok: boolean; status?: CanvasModelStatus; error?: string }>;
  saveConfig: (config: CanvasModelConfig) => Promise<{ ok: boolean; status?: CanvasModelStatus; error?: string }>;
  upsertProvider: (provider: CanvasModelProviderConfig) => Promise<{ ok: boolean; status?: CanvasModelStatus; error?: string }>;
  removeProvider: (providerId: string) => Promise<{ ok: boolean; status?: CanvasModelStatus; error?: string }>;
  fetchModels: (
    providerId?: string,
    provider?: CanvasModelProviderConfig,
  ) => Promise<{ ok: boolean; models?: CanvasProviderModel[]; error?: string }>;
  upsertOption: (
    option: CanvasModelOption,
    setCurrent?: boolean,
  ) => Promise<{ ok: boolean; status?: CanvasModelStatus; error?: string }>;
  setCurrent: (name?: string, providerId?: string) => Promise<{ ok: boolean; status?: CanvasModelStatus; error?: string }>;
  removeOption: (name: string) => Promise<{ ok: boolean; status?: CanvasModelStatus; error?: string }>;
  reset: () => Promise<{ ok: boolean; status?: CanvasModelStatus; error?: string }>;
}
