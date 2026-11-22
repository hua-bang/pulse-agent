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

export interface RemoteVpsDirEntry {
  name: string;
  path: string;
  hidden: boolean;
}

export interface RemoteVpsListDirsResult {
  ok: boolean;
  path?: string;
  parent?: string | null;
  home?: string;
  entries?: RemoteVpsDirEntry[];
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
  readWorkspaceDoc: (
    workspaceId: string,
    cwd?: string,
  ) => Promise<{ ok: boolean; exists?: boolean; content?: string | null; path?: string; error?: string }>;
  writeWorkspaceDoc: (
    workspaceId: string,
    content: string,
    cwd?: string,
  ) => Promise<{ ok: boolean; path?: string; error?: string }>;
  listDirs: (
    workspaceId: string,
    dirPath?: string,
    options?: { showHidden?: boolean; config?: RemoteVpsWorkspaceConfigDto },
  ) => Promise<RemoteVpsListDirsResult>;
}
