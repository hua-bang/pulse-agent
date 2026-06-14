export interface ChannelConfigStatus {
  path: string;
  feishu: {
    appId?: string;
    secretPresent: boolean;
    defaultWorkspaceId?: string;
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
