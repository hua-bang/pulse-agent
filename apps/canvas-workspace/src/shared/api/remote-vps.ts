export type RemoteVpsShareRole = 'viewer' | 'editor' | 'collaborator';

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
  shareRole?: RemoteVpsShareRole;
  allowCapabilityRelay?: boolean;
}

export interface RemoteVpsShareSummary {
  id: string;
  workspaceId: string;
  role: RemoteVpsShareRole;
  label?: string;
  createdAt: number;
  expiresAt?: number;
  tokenPreview: string;
}

export interface RemoteVpsTestResult {
  ok: boolean;
  version?: string;
  generation?: string;
  bundleHash?: string;
  tailscaleUrl?: string;
  uploaded?: boolean;
  installedDeps?: boolean;
  restarted?: boolean;
  token?: string;
  error?: string;
}

export interface RemoteVpsStatusResult {
  ok: boolean;
  connected: boolean;
  version?: string;
  bundleHash?: string;
  outdatedDaemon?: boolean;
  tailscaleUrl?: string;
  role?: string;
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
  getStatus: (workspaceId: string) => Promise<RemoteVpsStatusResult>;
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
  listShares: (
    workspaceId: string,
  ) => Promise<{ ok: boolean; shares?: RemoteVpsShareSummary[]; error?: string }>;
  createShare: (
    workspaceId: string,
    options: {
      role: RemoteVpsShareRole;
      label?: string;
      expiresInHours?: number;
      publicEndpoint?: string;
    },
  ) => Promise<{
    ok: boolean;
    inviteCode?: string;
    share?: RemoteVpsShareSummary & { token: string };
    error?: string;
  }>;
  revokeShare: (
    workspaceId: string,
    shareId: string,
  ) => Promise<{ ok: boolean; revoked?: boolean; error?: string }>;
  joinShare: (
    workspaceId: string,
    inviteCode: string,
  ) => Promise<{
    ok: boolean;
    config?: RemoteVpsWorkspaceConfigDto;
    role?: RemoteVpsShareRole;
    error?: string;
  }>;
}
