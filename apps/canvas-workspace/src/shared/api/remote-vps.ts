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
  shareLabel?: string;
  allowCapabilityRelay?: boolean;
}

export interface RemoteVpsShareSummary {
  id: string;
  workspaceId: string;
  role: RemoteVpsShareRole;
  label?: string;
  createdAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
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
  onlineClients?: number;
  role?: string;
  error?: string;
}

export interface RemoteVpsMigrateResult {
  ok: boolean;
  migrated?: boolean;
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

export interface RemoteVpsPresencePeer {
  clientId: string;
  name: string;
  role: string;
  activeNodeId?: string;
  viewport?: { x: number; y: number; scale: number };
  chatStream?: { conversationId: string; text: string };
  updatedAt: number;
  self?: boolean;
}

export interface RemoteVpsChatRoomActiveTurn {
  clientId: string;
  senderName: string;
  conversationId: string;
  /** Set when the daemon runs the turn; surfaces can attach to its live stream. */
  runId?: string;
  prompt?: string;
  text: string;
  toolName?: string;
  startedAt: number;
  updatedAt: number;
  self?: boolean;
}

export interface RemoteVpsChatRoomQueuedItem {
  id: string;
  clientId: string;
  senderName: string;
  message: string;
  createdAt: number;
  self?: boolean;
}

export interface RemoteVpsChatRoomEvent {
  workspaceId: string;
  conversationId: string;
  activeTurn: RemoteVpsChatRoomActiveTurn | null;
  queue: RemoteVpsChatRoomQueuedItem[];
  typingPeers?: string[];
  turnEnded?: boolean;
  endedBySelf?: boolean;
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
    options?: { onlyIfRemoteEmpty?: boolean },
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
      workspaceName?: string;
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
    workspaceName?: string;
    error?: string;
  }>;
  getPresence?: (
    workspaceId: string,
  ) => Promise<{ ok: boolean; peers: RemoteVpsPresencePeer[] }>;
  updatePresence?: (
    workspaceId: string,
    state: {
      activeNodeId?: string | null;
      viewport?: { x: number; y: number; scale: number } | null;
      chatStream?: { conversationId: string; text: string } | null;
    },
  ) => Promise<{ ok: boolean; peers: RemoteVpsPresencePeer[] }>;
  leavePresence?: (workspaceId: string) => Promise<{ ok: boolean }>;
  onJoinDeepLink?: (callback: (inviteCode: string) => void) => () => void;
  consumePendingJoinLinks?: () => Promise<string[]>;
  getChatRoomState?: (
    workspaceId: string,
    conversationId: string,
  ) => Promise<{
    ok: boolean;
    fallback?: boolean;
    selfName?: string;
    activeTurn: RemoteVpsChatRoomActiveTurn | null;
    queue: RemoteVpsChatRoomQueuedItem[];
  }>;
  enqueueChatRoom?: (
    workspaceId: string,
    conversationId: string,
    message: string,
  ) => Promise<{
    ok: boolean;
    fallback?: boolean;
    forbidden?: boolean;
    claimed?: boolean;
    queuedItem?: RemoteVpsChatRoomQueuedItem;
    activeTurn?: RemoteVpsChatRoomActiveTurn | null;
    queue?: RemoteVpsChatRoomQueuedItem[];
  }>;
  claimChatRoom?: (
    workspaceId: string,
    conversationId: string,
    options?: { popNext?: boolean },
  ) => Promise<{
    ok: boolean;
    claimed?: boolean;
    nextItem?: RemoteVpsChatRoomQueuedItem;
    activeTurn?: RemoteVpsChatRoomActiveTurn | null;
    queue?: RemoteVpsChatRoomQueuedItem[];
  }>;
  streamChatRoom?: (
    workspaceId: string,
    conversationId: string,
    text: string,
    toolName?: string,
  ) => Promise<{ ok: boolean }>;
  releaseChatRoom?: (workspaceId: string, conversationId: string) => Promise<{ ok: boolean }>;
  cancelChatRoomQueued?: (
    workspaceId: string,
    conversationId: string,
    itemId: string,
  ) => Promise<{ ok: boolean; removed?: boolean }>;
  setChatRoomTyping?: (
    workspaceId: string,
    conversationId: string,
    active: boolean,
  ) => Promise<{ ok: boolean }>;
  sendChatRoomNote?: (
    workspaceId: string,
    conversationId: string,
    message: string,
  ) => Promise<{ ok: boolean; forbidden?: boolean; error?: string }>;
  subscribeChatRoom?: (workspaceId: string) => Promise<{ ok: boolean }>;
  unsubscribeChatRoom?: (workspaceId: string) => Promise<{ ok: boolean }>;
  onChatRoomEvent?: (callback: (event: RemoteVpsChatRoomEvent) => void) => () => void;
}
