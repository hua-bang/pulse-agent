export interface ChannelConfigStatus {
  path: string;
  feishu: {
    /** Stored App ID (safe to echo — not a secret). */
    appId?: string;
    /** App Secret present (stored or via env). The secret itself is never returned. */
    secretPresent: boolean;
    /** Stored default workspace id. */
    defaultWorkspaceId?: string;
    /** Whether each value is currently overridden by an env var. */
    appIdFromEnv: boolean;
    secretFromEnv: boolean;
    defaultWorkspaceFromEnv: boolean;
  };
}

export interface SetFeishuConfigInput {
  appId?: string;
  /** New secret to store. Empty/omitted leaves the existing secret untouched. */
  appSecret?: string;
  defaultWorkspaceId?: string;
  /** When true, remove the stored secret. */
  clearSecret?: boolean;
}
