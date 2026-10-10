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
  /**
   * Number of characters in the saved API key when one is present and
   * decryptable. Undefined when no key is saved, or when an encrypted
   * blob exists but couldn't be decrypted on this machine. Exposed so
   * the settings UI can confirm to the user that a key really is on
   * disk without echoing it back.
   */
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
  /** User-authored extra instructions appended to the system prompt. */
  customPrompt: string;
}

export interface PromptProfileStatus extends PromptProfile {
  path: string;
}
