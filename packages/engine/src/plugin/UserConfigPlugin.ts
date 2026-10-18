import { z } from 'zod';

/**
 * @deprecated The declarative user-config loader was removed: it scanned
 * `.pulse-coder/config` but never applied tools, MCP servers or sub-agents.
 * These types remain exported for source compatibility only. Use
 * `.pulse-coder/mcp.json`, `.pulse-coder/agents/`, `.pulse-coder/skills/` or
 * an engine plugin instead.
 *
 * 用户配置插件接口 - 面向终端用户
 */
export interface UserConfigPlugin {
  version: string;
  name?: string;
  description?: string;

  // 工具配置 - 使用现有工具类型的具体配置
  tools?: Record<string, ToolConfig>;

  // MCP 服务器配置
  mcp?: {
    servers: MCPServerConfig[];
  };

  // 提示词配置
  prompts?: {
    system?: string;
    user?: string;
    assistant?: string;
  };

  // 子代理配置
  subAgents?: SubAgentConfig[];

  // 技能配置 (向后兼容)
  skills?: {
    directories?: string[];
    autoScan?: boolean;
    cache?: boolean;
  };

  // 环境配置
  env?: Record<string, string>;

  // 条件配置
  conditions?: {
    environment?: string;
    features?: string[];
  };
}

/**
 * 工具配置接口
 */
export const ToolConfigSchema = z.object({
  type: z.enum(['bash', 'http', 'javascript', 'skill', 'custom']),

  // Bash 工具配置
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.any().optional(),
  timeout: z.number().optional(),

  // HTTP 工具配置
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  url: z.string().optional(),
  baseUrl: z.string().optional(),
  headers: z.any().optional(),
  params: z.any().optional(),
  data: z.any().optional(),

  // JavaScript 工具配置
  code: z.string().optional(),

  // 通用字段
  description: z.string().optional(),
  enabled: z.boolean().optional().default(true),

  // 条件字段
  conditions: z.object({
    environment: z.string().optional(),
    platform: z.string().optional()
  }).optional()
});

export type ToolConfig = z.infer<typeof ToolConfigSchema>;

/**
 * MCP 服务器配置接口
 */
export const MCPServerConfigSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.any().optional(),
  cwd: z.string().optional(),
  timeout: z.number().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional().default(true)
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

/**
 * 子代理配置接口
 */
export const SubAgentConfigSchema = z.object({
  name: z.string(),
  trigger: z.array(z.string()),
  prompt: z.string(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  tools: z.array(z.string()).optional(),
  enabled: z.boolean().optional().default(true)
});

export type SubAgentConfig = z.infer<typeof SubAgentConfigSchema>;

/**
 * 用户配置插件加载选项
 */
/** @deprecated Accepted and ignored by Engine/PluginManager. */
export interface UserConfigPluginLoadOptions {
  configs?: UserConfigPlugin[];
  dirs?: string[];
  scan?: boolean;
}

/**
 * 默认用户配置插件目录
 */
export const DEFAULT_USER_CONFIG_PLUGIN_DIRS = [
  '.pulse-coder/config',
  '.coder/config',
  '~/.pulse-coder/config',
  '~/.coder/config',
  './config'
];

/**
 * 支持的文件格式
 */
export const SUPPORTED_CONFIG_FORMATS = ['.json', '.yaml', '.yml'];

/**
 * 配置验证结果
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * 环境变量替换工具
 */
export class ConfigVariableResolver {
  private env: Record<string, string>;

  constructor(env: Record<string, string> = {}) {
    this.env = env;
  }

  resolve(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const [name, defaultValue] = varName.split(':-');
      return this.env[name] || defaultValue || match;
    });
  }

  resolveObject(obj: any): any {
    if (typeof obj === 'string') {
      return this.resolve(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveObject(item));
    }
    if (typeof obj === 'object' && obj !== null) {
      const resolved: any = {};
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveObject(value);
      }
      return resolved;
    }
    return obj;
  }
}