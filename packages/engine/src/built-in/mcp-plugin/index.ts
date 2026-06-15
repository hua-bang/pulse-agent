/**
 * Built-in MCP Plugin for Pulse Coder Engine
 * 将 MCP 功能作为引擎内置插件
 */

import { EnginePlugin, EnginePluginContext } from '../../plugin/EnginePlugin';
import { createMCPClient, type MCPClientConfig, type OAuthClientProvider } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import * as path from 'path';

type RawMCPServerConfig = Record<string, unknown>;

export interface HTTPOrSSEServerConfig {
  transport: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
  auth?: string;
  oauth?: Record<string, unknown>;
  deferTools?: boolean;
  disabledTools?: string[];
}

interface StdioServerConfig {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  deferTools?: boolean;
  disabledTools?: string[];
}

interface NormalizedServerConfigBase {
  deferTools?: boolean;
  /** Bare tool names (without the `mcp_<server>_` prefix) the host has turned off. */
  disabledTools?: string[];
}

type NormalizedMCPServerConfig = (HTTPOrSSEServerConfig | StdioServerConfig) & NormalizedServerConfigBase;

export interface MCPPluginConfig {
  servers: Record<string, RawMCPServerConfig>;
}

function readMCPConfigFile(configPath: string): MCPPluginConfig {
  if (!existsSync(configPath)) {
    return { servers: {} };
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!parsed.servers || typeof parsed.servers !== 'object') {
      console.warn('[MCP] Invalid config: missing "servers" object');
      return { servers: {} };
    }

    return { servers: parsed.servers as Record<string, RawMCPServerConfig> };
  } catch (error) {
    console.warn(`[MCP] Failed to load config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { servers: {} };
  }
}

/**
 * 按给定顺序合并多个配置文件的 servers，后者覆盖前者（同名 server）。
 */
export function loadMCPConfigFromPaths(configPaths: string[]): MCPPluginConfig {
  const mergedServers: Record<string, RawMCPServerConfig> = {};
  for (const configPath of configPaths) {
    const { servers } = readMCPConfigFile(configPath);
    Object.assign(mergedServers, servers);
  }
  return { servers: mergedServers };
}

export async function loadMCPConfig(cwd: string): Promise<MCPPluginConfig> {
  // 合并用户级与项目级配置，后者覆盖前者
  const projectConfigPath = path.join(cwd, '.pulse-coder', 'mcp.json');
  const legacyProjectConfigPath = path.join(cwd, '.coder', 'mcp.json');
  const homeConfigPath = path.join(homedir(), '.pulse-coder', 'mcp.json');
  const legacyHomeConfigPath = path.join(homedir(), '.coder', 'mcp.json');

  return loadMCPConfigFromPaths([
    legacyHomeConfigPath,
    homeConfigPath,
    legacyProjectConfigPath,
    projectConfigPath
  ]);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(item => typeof item === 'string');
}

function readDeferTools(raw: RawMCPServerConfig, serverName: string): boolean | undefined {
  const value = raw.deferTools;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  console.warn(`[MCP] Server "${serverName}" has invalid deferTools; expected boolean, ignoring`);
  return undefined;
}

function readDisabledTools(raw: RawMCPServerConfig, serverName: string): string[] | undefined {
  const value = raw.disabledTools;
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    console.warn(`[MCP] Server "${serverName}" has invalid disabledTools; expected string array, ignoring`);
    return undefined;
  }
  const cleaned = value.map(item => item.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}


function normalizeServerConfig(serverName: string, raw: RawMCPServerConfig): NormalizedMCPServerConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn(`[MCP] Server "${serverName}" config must be an object, skipping`);
    return null;
  }

  const transport = typeof raw.transport === 'string' ? raw.transport.toLowerCase() : 'http';
  const deferTools = readDeferTools(raw, serverName);
  const disabledTools = readDisabledTools(raw, serverName);

  if (transport === 'http' || transport === 'sse') {
    if (typeof raw.url !== 'string' || !raw.url.trim()) {
      console.warn(`[MCP] Server "${serverName}" missing URL for ${transport} transport, skipping`);
      return null;
    }

    const normalized: HTTPOrSSEServerConfig = {
      transport,
      url: raw.url,
      deferTools,
      disabledTools
    };

    if (raw.headers !== undefined) {
      if (!isStringRecord(raw.headers)) {
        console.warn(`[MCP] Server "${serverName}" has invalid headers; expected string map, ignoring headers`);
      } else {
        normalized.headers = raw.headers;
      }
    }
    if (typeof raw.auth === 'string' && raw.auth.trim()) {
      normalized.auth = raw.auth.trim();
    }
    if (raw.oauth !== undefined) {
      if (!raw.oauth || typeof raw.oauth !== 'object' || Array.isArray(raw.oauth)) {
        console.warn(`[MCP] Server "${serverName}" has invalid oauth; expected object, ignoring oauth`);
      } else {
        normalized.oauth = raw.oauth as Record<string, unknown>;
      }
    }

    return normalized;
  }

  if (transport === 'stdio') {
    if (typeof raw.command !== 'string' || !raw.command.trim()) {
      console.warn(`[MCP] Server "${serverName}" missing command for stdio transport, skipping`);
      return null;
    }

    const normalized: StdioServerConfig = {
      transport: 'stdio',
      command: raw.command,
      deferTools,
      disabledTools
    };

    if (raw.args !== undefined) {
      if (!Array.isArray(raw.args) || !raw.args.every(arg => typeof arg === 'string')) {
        console.warn(`[MCP] Server "${serverName}" has invalid args; expected string array, ignoring args`);
      } else {
        normalized.args = raw.args;
      }
    }

    if (raw.env !== undefined) {
      if (!isStringRecord(raw.env)) {
        console.warn(`[MCP] Server "${serverName}" has invalid env; expected string map, ignoring env`);
      } else {
        normalized.env = raw.env;
      }
    }

    if (raw.cwd !== undefined) {
      if (typeof raw.cwd !== 'string' || !raw.cwd.trim()) {
        console.warn(`[MCP] Server "${serverName}" has invalid cwd; expected non-empty string, ignoring cwd`);
      } else {
        normalized.cwd = raw.cwd;
      }
    }

    return normalized;
  }

  console.warn(`[MCP] Server "${serverName}" has unsupported transport "${transport}", skipping`);
  return null;
}


export interface MCPAuthProviderFactoryContext {
  serverName: string;
  config: HTTPOrSSEServerConfig;
}

export type MCPAuthProviderFactory = (
  context: MCPAuthProviderFactoryContext,
) => OAuthClientProvider | undefined | Promise<OAuthClientProvider | undefined>;

async function createTransport(
  serverName: string,
  config: NormalizedMCPServerConfig,
  authProviderFactory?: MCPAuthProviderFactory,
): Promise<MCPClientConfig['transport']> {
  if (config.transport === 'stdio') {
    return new Experimental_StdioMCPTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd
    });
  }

  return {
    type: config.transport,
    url: config.url,
    headers: config.headers,
    authProvider: await authProviderFactory?.({ serverName, config })
  };
}

/**
 * 单个 MCP 工具的元信息，供宿主展示与启用/禁用切换。
 * `name` 为去除 `mcp_<server>_` 前缀后的原始工具名。
 */
export interface McpToolInfo {
  name: string;
  description?: string;
  /** false 表示该工具被禁用，未注册进引擎工具表。 */
  enabled: boolean;
}

/**
 * 单个 MCP server 的连接结果,供宿主在配置变更后展示给用户。
 * `toolCount` 为实际注册（启用）的工具数；`tools` 列出全部工具及其启用状态。
 */
export type MCPServerStatus =
  | { ok: true; toolCount: number; tools: McpToolInfo[] }
  | { ok: false; error: string };

/**
 * 管理本插件创建的所有 MCP client，便于宿主在重建 Engine 前统一关闭，
 * 避免 stdio 子进程 / 长连接泄漏。注册为服务 `mcp:__manager__`。
 */
export interface MCPClientManager {
  closeAll(): Promise<void>;
  /** Per-server health snapshot captured during the last `initialize`. */
  getStatuses(): Record<string, MCPServerStatus>;
}

/**
 * MCP 插件配置。
 * - `configPaths` 显式指定按序合并的配置文件路径（多 scope 场景，后者覆盖前者）。
 * - `cwd` 默认配置路径集的根目录（仅当未提供 configPaths 时生效）。
 */
export interface MCPPluginOptions {
  configPaths?: string[];
  cwd?: string;
  authProviderFactory?: MCPAuthProviderFactory;
}

/**
 * 创建内置 MCP 插件。
 *
 * MCP 工具在 initialize 期静态注册进引擎工具表，没有 per-run 注入，
 * 因此配置变更后需由宿主重建 Engine 生效；重建前请调用 `mcp:__manager__`
 * 服务（或插件 destroy）的 closeAll 关闭旧 client。
 */
export function createMcpPlugin(options: MCPPluginOptions = {}): EnginePlugin {
  const clients: Array<{ close?: () => Promise<void> | void }> = [];
  // Captured per-server during initialize so the host can show
  // "✓ N tools" or "⚠ <error>" without re-probing.
  const statuses: Record<string, MCPServerStatus> = {};

  const closeAll = async () => {
    for (const client of clients.splice(0)) {
      try {
        await client.close?.();
      } catch (error) {
        console.warn(`[MCP] Failed to close client: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  return {
    name: 'pulse-coder-engine/built-in-mcp',
    version: '1.1.0',

    async initialize(context: EnginePluginContext) {
      const config = options.configPaths
        ? loadMCPConfigFromPaths(options.configPaths)
        : await loadMCPConfig(options.cwd ?? process.cwd());

      // Fresh init wipes any statuses left over from a previous run.
      for (const key of Object.keys(statuses)) delete statuses[key];

      const manager: MCPClientManager = {
        closeAll,
        getStatuses: () => ({ ...statuses })
      };
      context.registerService('mcp:__manager__', manager);

      const serverCount = Object.keys(config.servers).length;
      if (serverCount === 0) {
        console.log('[MCP] No MCP servers configured');
        return;
      }

      let loadedCount = 0;

      for (const [serverName, rawServerConfig] of Object.entries(config.servers)) {
        try {
          const normalizedConfig = normalizeServerConfig(serverName, rawServerConfig);
          if (!normalizedConfig) {
            statuses[serverName] = { ok: false, error: 'invalid config (see warnings)' };
            continue;
          }

          const transport = await createTransport(
            serverName,
            normalizedConfig,
            options.authProviderFactory
          );
          const client = await createMCPClient({ transport });
          clients.push(client as { close?: () => Promise<void> | void });

          const tools = await client.tools();
          const shouldDeferTools = normalizedConfig.deferTools === true;
          const disabledTools = new Set(normalizedConfig.disabledTools ?? []);

          // 逐个工具决定是否注册：被禁用的工具不进引擎工具表（agent 不可见），
          // 但仍记入 status.tools（enabled:false），供宿主展示与切换。
          const toolInfos: McpToolInfo[] = [];
          const namespacedTools: Record<string, any> = {};
          for (const [toolName, tool] of Object.entries(tools)) {
            const enabled = !disabledTools.has(toolName);
            const description = typeof (tool as any)?.description === 'string'
              ? ((tool as any).description as string)
              : undefined;
            toolInfos.push({ name: toolName, description, enabled });
            if (!enabled) continue;
            // 注册工具到引擎，使用命名空间前缀
            namespacedTools[`mcp_${serverName}_${toolName}`] = shouldDeferTools
              ? { ...(tool as any), defer_loading: true }
              : (tool as any);
          }

          context.registerTools(namespacedTools);

          const toolCount = Object.keys(namespacedTools).length;
          loadedCount++;
          statuses[serverName] = { ok: true, toolCount, tools: toolInfos };
          console.log(`[MCP] Server "${serverName}" loaded (${toolCount}/${toolInfos.length} tools)`);

          // 注册服务供其他插件使用
          context.registerService(`mcp:${serverName}`, client);

        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          statuses[serverName] = { ok: false, error: message };
          console.warn(`[MCP] Failed to load server "${serverName}": ${message}`);
        }
      }

      if (loadedCount > 0) {
        console.log(`[MCP] Successfully loaded ${loadedCount}/${serverCount} MCP servers`);
      } else {
        console.warn('[MCP] No MCP servers were loaded successfully');
      }
    },

    async destroy() {
      await closeAll();
    }
  };
}

/**
 * 内置 MCP 插件（默认实例，使用 cwd + homedir 默认配置路径）。
 */
export const builtInMCPPlugin: EnginePlugin = createMcpPlugin();

export default builtInMCPPlugin;
