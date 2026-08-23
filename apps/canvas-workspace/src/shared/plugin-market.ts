/**
 * Runtime-neutral contracts for Agent Plugin packages and the Canvas plugin
 * market. Keep every value JSON-safe so these types can cross IPC unchanged.
 */

export const AGENT_PLUGIN_V1_SCHEMA =
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
export const AGENT_PLUGIN_MCP_V1_SCHEMA =
  'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
export const PULSE_CANVAS_EXTENSION_NAMESPACE = 'com.pulsecanvas';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export type PluginPackageDiagnosticSeverity = 'warning' | 'error';
export type PluginPackageDiagnosticScope =
  | 'package'
  | 'manifest'
  | 'skills'
  | 'skill'
  | 'mcp'
  | 'mcp-server'
  | 'pulse-extension'
  | 'legacy-manifest';

export interface PluginPackageDiagnostic {
  severity: PluginPackageDiagnosticSeverity;
  scope: PluginPackageDiagnosticScope;
  code: string;
  message: string;
  path?: string;
  componentId?: string;
}

export interface PluginPackageAuthor {
  name?: string;
  email?: string;
  url?: string;
}

export interface PluginPackageSkill {
  name: string;
  description: string;
  directory: string;
  skillPath: string;
}

export interface PluginPackageStdioMcpServer {
  name: string;
  type: 'stdio';
  command: string;
  resolvedCommand?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  resolvedCwd?: string;
}

export interface PluginPackageRemoteMcpServer {
  name: string;
  type: 'streamable-http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type PluginPackageMcpServer =
  | PluginPackageStdioMcpServer
  | PluginPackageRemoteMcpServer;

export interface PluginPackageMcpComponent {
  path: string;
  servers: PluginPackageMcpServer[];
}

export interface PulseCanvasPluginMain {
  entry: string;
  format?: string;
  runtime?: string;
  permissions?: string[];
}

export interface PulseCanvasPluginRenderer {
  remoteName?: string;
  name?: string;
  entry?: string;
  expose?: string;
  type?: string;
  entryGlobalName?: string;
}

export interface PulseCanvasPluginNode {
  type: string;
  title?: string;
  icon?: string;
  capabilities?: string[];
  actions?: string[];
  renderer?: PulseCanvasPluginRenderer;
}

export interface PulseCanvasPluginConfigField {
  key: string;
  label?: string;
  description?: string;
  type?: 'string' | 'password' | 'url';
  placeholder?: string;
  required?: boolean;
  envKeys?: string[];
}

export interface PluginPackagePulseExtension {
  namespace: typeof PULSE_CANVAS_EXTENSION_NAMESPACE;
  source: 'plugin-extension' | 'legacy-manifest';
  /** Filesystem-resolved extension directory, when the package provides one. */
  directory?: string;
  /** Original JSON object, retained for forwards-compatible client fields. */
  data: JsonObject;
  schemaVersion?: number;
  main?: PulseCanvasPluginMain;
  nodes: PulseCanvasPluginNode[];
  config: PulseCanvasPluginConfigField[];
}

export type PluginPackageFormat = 'agent-plugin' | 'legacy-canvas';

export interface NormalizedPluginPackage {
  format: PluginPackageFormat;
  root: string;
  manifestPath: string;
  name: string;
  version?: string;
  description?: string;
  author?: PluginPackageAuthor;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords: string[];
  skills: PluginPackageSkill[];
  mcp?: PluginPackageMcpComponent;
  pulseExtension?: PluginPackagePulseExtension;
}

export interface PluginPackageReadResult {
  package: NormalizedPluginPackage | null;
  diagnostics: PluginPackageDiagnostic[];
}

export interface PluginMarketSource {
  kind: 'directory' | 'git';
  path?: string;
  url?: string;
  ref?: string;
  subdir?: string;
}

export type PluginMarketVisibility = 'public' | 'personal';
export type PluginMarketSourceFormat =
  | 'agent-plugin'
  | 'legacy-canvas'
  | 'claude'
  | 'codex'
  | 'skill-collection';
export type PluginMarketInstallState = 'available' | 'installed' | 'unsupported';
export type PluginMarketMcpAuthState = 'connectable' | 'connected';

export interface PluginMarketCapabilities {
  skillCount: number;
  mcpServerCount: number;
  hasPulseExtension: boolean;
}

export interface PluginMarketListing {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: PluginPackageAuthor;
  license?: string;
  category: string;
  featured: boolean;
  visibility: PluginMarketVisibility;
  sourceFormat: PluginMarketSourceFormat;
  source: PluginMarketSource;
  iconKey?: string;
  capabilities: PluginMarketCapabilities;
  installState: PluginMarketInstallState;
  /** Present for installed packages with one or more remote MCP servers. */
  mcpAuthState?: PluginMarketMcpAuthState;
  /** Explicit trust gate; installation alone never enables native Pulse code. */
  nativeEnabled?: boolean;
  error?: string;
}

export interface PluginMarketSnapshot {
  listings: PluginMarketListing[];
  updatedAt: number;
}

export interface PluginMarketMutationResult {
  ok: boolean;
  snapshot?: PluginMarketSnapshot;
  diagnostics?: PluginPackageDiagnostic[];
  canceled?: boolean;
  source?: PluginMarketSource;
  error?: string;
}

export interface PluginMarketApi {
  list: () => Promise<{ ok: boolean; snapshot?: PluginMarketSnapshot; error?: string }>;
  refresh: () => Promise<{ ok: boolean; snapshot?: PluginMarketSnapshot; error?: string }>;
  install: (listingId: string) => Promise<PluginMarketMutationResult>;
  uninstall: (listingId: string) => Promise<PluginMarketMutationResult>;
  connectMcp: (listingId: string) => Promise<PluginMarketMutationResult>;
  setNativeEnabled: (
    listingId: string,
    enabled: boolean,
  ) => Promise<PluginMarketMutationResult>;
  chooseDirectory: () => Promise<PluginMarketMutationResult>;
  addGit: (source: PluginMarketSource) => Promise<PluginMarketMutationResult>;
}
