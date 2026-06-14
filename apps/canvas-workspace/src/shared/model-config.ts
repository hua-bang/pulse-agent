export type CanvasModelProviderType = 'openai' | 'claude';

export interface CanvasModelOption {
  name: string;
  provider_type?: CanvasModelProviderType;
  model?: string;
  base_url?: string;
  api_key_env?: string;
  headers?: Record<string, string>;
}

export interface CanvasProviderModel {
  id: string;
  name?: string;
}

export interface CanvasModelProviderConfig {
  id: string;
  name: string;
  provider_type?: CanvasModelProviderType;
  base_url?: string;
  api_key_env?: string;
  api_key?: string;
  headers?: Record<string, string>;
  models?: CanvasProviderModel[];
}

export interface CanvasModelConfig {
  current_provider?: string;
  current_model?: string;
  provider_type?: CanvasModelProviderType;
  model?: string;
  base_url?: string;
  api_key_env?: string;
  headers?: Record<string, string>;
  options?: CanvasModelOption[];
  providers?: CanvasModelProviderConfig[];
}

export interface CanvasModelProviderStatus {
  id: string;
  name: string;
  provider_type: CanvasModelProviderType;
  base_url?: string;
  api_key_env?: string;
  apiKeyPresent: boolean;
  apiKeyLength?: number;
  headers?: Record<string, string>;
  models: CanvasProviderModel[];
}

export interface CanvasModelStatus {
  path: string;
  currentProvider?: string;
  currentModel?: string;
  providerType: CanvasModelProviderType;
  resolvedModel: string;
  resolvedBaseURL?: string;
  resolvedApiKeyEnv?: string;
  apiKeyPresent: boolean;
  options: CanvasModelOption[];
  providers: CanvasModelProviderStatus[];
}

export type PromptPreset = 'concise' | 'balanced' | 'detailed';

export interface PromptProfile {
  preset: PromptPreset;
  customPrompt: string;
}

export interface PromptProfileStatus extends PromptProfile {
  path: string;
}
