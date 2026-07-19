import type {
  BuiltInToolCredentialId,
  BuiltInToolsConfigStatus,
  CanvasConfigScope,
  CanvasMcpImportEntry,
  CanvasMcpServer,
  CanvasMcpStatus,
  CanvasPluginsImportEntry,
  CanvasPluginsStatus,
  CanvasSkillImportEntry,
  CanvasSkillInput,
  CanvasSkillsStatus,
  SkillsCleanupResult,
  SkillsInstallResult,
  SkillsStatusResult,
  AgentToolingUpdatePolicy,
} from '../../../shared/settings-config';

export type * from '../../../shared/settings-config';

export interface SkillsApi {
  install: () => Promise<SkillsInstallResult>;
  update: () => Promise<SkillsInstallResult>;
  status: () => Promise<SkillsStatusResult>;
  setUpdatePolicy: (policy: AgentToolingUpdatePolicy) => Promise<SkillsStatusResult>;
  cleanupLegacy: () => Promise<SkillsCleanupResult>;
}

export interface BuiltInToolsConfigApi {
  status: () => Promise<{ ok: boolean; status?: BuiltInToolsConfigStatus; error?: string }>;
  setCredential: (
    id: BuiltInToolCredentialId,
    input: { apiKey?: string; baseUrl?: string },
  ) => Promise<{ ok: boolean; status?: BuiltInToolsConfigStatus; error?: string }>;
  clearCredential: (
    id: BuiltInToolCredentialId,
  ) => Promise<{ ok: boolean; status?: BuiltInToolsConfigStatus; error?: string }>;
}

export interface CanvasSkillsApi {
  list: (scope: CanvasConfigScope) => Promise<{ ok: boolean; status?: CanvasSkillsStatus; error?: string }>;
  upsert: (
    scope: CanvasConfigScope,
    skill: CanvasSkillInput,
  ) => Promise<{ ok: boolean; status?: CanvasSkillsStatus; error?: string }>;
  remove: (
    scope: CanvasConfigScope,
    name: string,
  ) => Promise<{ ok: boolean; status?: CanvasSkillsStatus; error?: string }>;
  importZip: (
    scope: CanvasConfigScope,
    bytes: ArrayBuffer,
  ) => Promise<{
    ok: boolean;
    status?: CanvasSkillsStatus;
    entries?: CanvasSkillImportEntry[];
    error?: string;
  }>;
  importMd: (
    scope: CanvasConfigScope,
    text: string,
  ) => Promise<{
    ok: boolean;
    status?: CanvasSkillsStatus;
    name?: string;
    result?: 'imported' | 'replaced';
    error?: string;
  }>;
  importUrl: (
    scope: CanvasConfigScope,
    url: string,
  ) => Promise<{
    ok: boolean;
    status?: CanvasSkillsStatus;
    /** Tells the caller which underlying importer ran, so it can pick the right toast. */
    kind?: 'md' | 'zip';
    name?: string;
    result?: 'imported' | 'replaced';
    entries?: CanvasSkillImportEntry[];
    error?: string;
  }>;
}

export interface CanvasMcpApi {
  list: (scope: CanvasConfigScope) => Promise<{ ok: boolean; status?: CanvasMcpStatus; error?: string }>;
  upsert: (
    scope: CanvasConfigScope,
    server: CanvasMcpServer,
    originalName?: string,
  ) => Promise<{ ok: boolean; status?: CanvasMcpStatus; error?: string }>;
  remove: (
    scope: CanvasConfigScope,
    name: string,
  ) => Promise<{ ok: boolean; status?: CanvasMcpStatus; error?: string }>;
  reload: (scope: CanvasConfigScope) => Promise<{ ok: boolean; status?: CanvasMcpStatus; error?: string }>;
  importJson: (
    scope: CanvasConfigScope,
    json: string,
  ) => Promise<{
    ok: boolean;
    status?: CanvasMcpStatus;
    entries?: CanvasMcpImportEntry[];
    error?: string;
  }>;
  setToolEnabled: (
    scope: CanvasConfigScope,
    name: string,
    tool: string,
    enabled: boolean,
  ) => Promise<{ ok: boolean; status?: CanvasMcpStatus; error?: string }>;
  oauthConnect: (
    scope: CanvasConfigScope,
    name: string,
  ) => Promise<{ ok: boolean; status?: CanvasMcpStatus; error?: string }>;
  oauthDisconnect: (
    scope: CanvasConfigScope,
    name: string,
  ) => Promise<{ ok: boolean; status?: CanvasMcpStatus; error?: string }>;
}

export interface CanvasPluginsApi {
  list: () => Promise<{ ok: boolean; status?: CanvasPluginsStatus; error?: string }>;
  addDirectory: (
    dir: string,
  ) => Promise<{ ok: boolean; status?: CanvasPluginsStatus; error?: string }>;
  chooseDirectory: () => Promise<{
    ok: boolean;
    canceled?: boolean;
    selectedDir?: string;
    status?: CanvasPluginsStatus;
    error?: string;
  }>;
  removeDirectory: (
    dir: string,
  ) => Promise<{ ok: boolean; status?: CanvasPluginsStatus; error?: string }>;
  importJson: (
    json: string,
  ) => Promise<{
    ok: boolean;
    status?: CanvasPluginsStatus;
    entries?: CanvasPluginsImportEntry[];
    error?: string;
  }>;
  setConfig: (
    pluginId: string,
    key: string,
    value: string,
  ) => Promise<{ ok: boolean; status?: CanvasPluginsStatus; error?: string }>;
}
