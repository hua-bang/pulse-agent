export interface RemoteVpsWorkspaceConfigDto {
  kind: 'vps';
  endpoint?: string;
  sshHost?: string;
  sshPort?: number;
  remotePort?: number;
  token?: string;
  tokenEnv?: string;
  remoteWorkspaceId?: string;
  cwd?: string;
  storage?: 'vps' | 'local';
  runtime?: 'vps' | 'local';
  autoBootstrap?: boolean;
}

export interface RemoteVpsTestResult {
  ok: boolean;
  version?: string;
  generation?: string;
  uploaded?: boolean;
  installedDeps?: boolean;
  restarted?: boolean;
  token?: string;
  error?: string;
}

export interface RemoteVpsMigrateResult {
  ok: boolean;
  remoteWorkspaceId?: string;
  canvasRevision?: number;
  conversationCount?: number;
  uploadedFiles?: number;
  error?: string;
}

export interface RemoteVpsApi {
  listSshHosts: () => Promise<{ ok: boolean; hosts: string[] }>;
  getConfig: (
    workspaceId: string,
  ) => Promise<{ ok: boolean; config: RemoteVpsWorkspaceConfigDto | null }>;
  saveConfig: (
    workspaceId: string,
    config: RemoteVpsWorkspaceConfigDto,
  ) => Promise<{ ok: boolean; error?: string }>;
  removeConfig: (
    workspaceId: string,
  ) => Promise<{ ok: boolean; removed?: boolean; error?: string }>;
  testAndBootstrap: (
    workspaceId: string,
    config: RemoteVpsWorkspaceConfigDto,
  ) => Promise<RemoteVpsTestResult>;
  migrateLocal: (
    workspaceId: string,
    config: RemoteVpsWorkspaceConfigDto,
  ) => Promise<RemoteVpsMigrateResult>;
}
