export interface SkillTargetResult {
  path: string;
  ok: boolean;
  error?: string;
}

export interface SkillsInstallResult {
  ok: boolean;
  skillsInstalled: boolean;
  results: SkillTargetResult[];
  cliInstalled: boolean;
  manualCommand?: string | null;
  cliError?: string | null;
  error?: string;
}

export interface SkillsStatusResult {
  installed: boolean;
  results: SkillTargetResult[];
  legacyDirs: string[];
}

export interface SkillsCleanupResult {
  ok: boolean;
  results: SkillTargetResult[];
}

export type BuiltInToolCredentialId = 'openai' | 'gemini' | 'tavily';

export interface BuiltInToolCredentialStatus {
  id: BuiltInToolCredentialId;
  name: string;
  description: string;
  envKey: string;
  baseUrlEnvKey: string;
  defaultBaseUrl: string;
  tools: string[];
  apiKeyPresent: boolean;
  apiKeyLength?: number;
  source: 'stored' | 'env' | 'missing';
  baseUrl: string;
  baseUrlSource: 'stored' | 'env' | 'default';
}

export interface BuiltInToolsConfigStatus {
  path: string;
  credentials: BuiltInToolCredentialStatus[];
}

export type CanvasConfigScope =
  | { level: 'global' }
  | { level: 'workspace'; workspaceId: string };

export type CanvasSkillSourceName =
  | 'canvas'
  | 'pulse-coder'
  | 'agents'
  | 'coder'
  | 'claude'
  | 'codex'
  | 'plugin';

export interface CanvasSkillEntry {
  name: string;
  description: string;
  body: string;
  scope: 'global' | 'workspace';
  path: string;
  source: CanvasSkillSourceName;
  /** False for skills owned by other agent tools; Edit/Delete are hidden. */
  writable: boolean;
}

export interface CanvasSkillsStatus {
  scope: 'global' | 'workspace';
  dir: string;
  skills: CanvasSkillEntry[];
}

export interface CanvasSkillInput {
  name: string;
  description: string;
  body: string;
  originalName?: string;
}

export interface CanvasSkillImportEntry {
  name: string;
  status: 'imported' | 'replaced' | 'skipped';
  reason?: string;
}

export type CanvasMcpTransport = 'http' | 'sse' | 'stdio';
export type CanvasMcpAuth = 'none' | 'oauth';

export interface CanvasMcpOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

export interface CanvasMcpServer {
  name: string;
  transport: CanvasMcpTransport;
  url?: string;
  headers?: Record<string, string>;
  auth?: CanvasMcpAuth;
  oauth?: CanvasMcpOAuthConfig;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  deferTools?: boolean;
  /** Bare tool names the user has turned off; the engine skips registering these. */
  disabledTools?: string[];
}

/** One tool exposed by a connected MCP server, with its enabled state. */
export interface CanvasMcpToolInfo {
  name: string;
  description?: string;
  enabled: boolean;
}

export type CanvasMcpServerHealth =
  | { ok: true; toolCount: number; tools?: CanvasMcpToolInfo[] }
  | { ok: false; error: string };

export interface CanvasMcpOAuthStatus {
  connected: boolean;
  hasClientInformation: boolean;
}

export interface CanvasMcpStatus {
  scope: 'global' | 'workspace';
  path: string;
  servers: CanvasMcpServer[];
  /**
   * Per-server connection health from the engine's MCP plugin. Servers
   * absent from this map have never been loaded by an active agent yet.
   */
  statuses?: Record<string, CanvasMcpServerHealth>;
  oauthStatuses?: Record<string, CanvasMcpOAuthStatus>;
}

export interface CanvasMcpImportEntry {
  name: string;
  status: 'added' | 'replaced' | 'skipped';
  reason?: string;
}

export interface CanvasPluginRendererSpec {
  id: string;
  name: string;
  entry: string;
  expose?: string;
  type?: string;
  entryGlobalName?: string;
  version?: string;
}

export interface CanvasPluginMainSpec {
  entry: string;
  format?: string;
  runtime?: string;
  permissions?: string[];
}

export interface CanvasPluginSkillSpec {
  /** Optional manifest hint. The SKILL.md front matter remains the runtime source of truth. */
  name?: string;
  description?: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Directory scanned by the engine for this skill. */
  scanPath: string;
}

export type CanvasPluginConfigFieldType = 'string' | 'password' | 'url';

export interface CanvasPluginConfigField {
  key: string;
  label?: string;
  description?: string;
  type?: CanvasPluginConfigFieldType;
  placeholder?: string;
  required?: boolean;
  envKeys?: string[];
}

export interface CanvasPluginConfigFieldStatus extends CanvasPluginConfigField {
  configured: boolean;
  source: 'stored' | 'env' | 'missing';
  valueLength?: number;
}

export interface CanvasPluginManifestNode {
  type: string;
  title?: string;
  /**
   * Optional icon hint for creation menus. Built-in tokens such as
   * "plugin", "note", "todo", and "excalidraw" are supported; relative
   * asset paths may be resolved by the host.
   */
  icon?: string;
  capabilities?: string[];
  actions?: string[];
  renderer?: {
    remoteName?: string;
    name?: string;
    entry?: string;
    expose?: string;
    type?: string;
    entryGlobalName?: string;
  };
}

export interface CanvasPluginEntry {
  id: string;
  version?: string;
  dir: string;
  manifestPath: string;
  main?: CanvasPluginMainSpec;
  skills?: CanvasPluginSkillSpec[];
  config?: CanvasPluginConfigField[];
  configStatus?: CanvasPluginConfigFieldStatus[];
  nodes: CanvasPluginManifestNode[];
  rendererSpecs: CanvasPluginRendererSpec[];
  error?: string;
}

export interface CanvasPluginsStatus {
  path: string;
  pluginDirs: string[];
  plugins: CanvasPluginEntry[];
  rendererSpecs: CanvasPluginRendererSpec[];
}

export interface CanvasPluginsImportEntry {
  dir: string;
  status: 'added' | 'existing' | 'skipped';
  reason?: string;
}
