import { promises as fs } from 'fs';
import { validateHeaderName, validateHeaderValue } from 'http';
import { join } from 'path';
import {
  AGENT_PLUGIN_MCP_V1_SCHEMA,
  type PluginPackageDiagnostic,
  type PluginPackageMcpComponent,
  type PluginPackageMcpServer,
} from '../../shared/plugin-market';
import {
  containedRealpath,
  diagnostic,
  errorMessage,
  isRecord,
  pathExists,
  readJson,
  resolvePackagePath,
  stringArray,
  stringRecord,
} from './package-reader-support';

const STDIO_FIELDS = new Set(['type', 'command', 'args', 'env', 'cwd']);
const REMOTE_FIELDS = new Set(['type', 'url', 'headers']);
const SENSITIVE_REMOTE_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'api-key',
]);

function assertClosed(value: Record<string, unknown>, fields: Set<string>): void {
  const unknown = Object.keys(value).find((key) => !fields.has(key));
  if (unknown) throw new Error(`Unknown field \`${unknown}\``);
}

function hasSafePlaceholderTail(value: string, prefix: string): boolean {
  if (value === prefix) return true;
  if (!value.startsWith(`${prefix}/`)) return false;
  return !value.slice(prefix.length + 1).split(/[\\/]+/).some((part) => part === '..');
}

async function normalizeCwd(root: string, cwd: string): Promise<string | undefined> {
  if (cwd.startsWith('./')) return resolvePackagePath(root, cwd, 'directory');
  if (hasSafePlaceholderTail(cwd, '${PLUGIN_ROOT}')) {
    const suffix = cwd.slice('${PLUGIN_ROOT}'.length).replace(/^\//, '');
    return suffix ? resolvePackagePath(root, suffix, 'directory') : root;
  }
  if (hasSafePlaceholderTail(cwd, '${PLUGIN_DATA}')) return undefined;
  throw new Error('cwd must be ./, ${PLUGIN_ROOT}, or ${PLUGIN_DATA} rooted');
}

async function normalizeStdio(
  root: string,
  name: string,
  value: Record<string, unknown>,
): Promise<PluginPackageMcpServer> {
  assertClosed(value, STDIO_FIELDS);
  if (value.type !== 'stdio') throw new Error('type must be `stdio`');
  const command = typeof value.command === 'string' ? value.command : '';
  if (!command) throw new Error('command must be a non-empty string');

  let resolvedCommand: string | undefined;
  if (command.startsWith('./')) {
    resolvedCommand = await resolvePackagePath(root, command, 'file');
  } else if (/[\\/\s]/.test(command)) {
    throw new Error('command must be a bare executable or a path beginning with ./');
  }

  const args = value.args === undefined ? undefined : stringArray(value.args);
  if (args === null) throw new Error('args must be an array of strings');
  const env = value.env === undefined ? undefined : stringRecord(value.env);
  if (env === null) throw new Error('env must be an object of strings');
  if (env && ('PLUGIN_ROOT' in env || 'PLUGIN_DATA' in env)) {
    throw new Error('env must not override PLUGIN_ROOT or PLUGIN_DATA');
  }
  const cwd = value.cwd;
  if (cwd !== undefined && typeof cwd !== 'string') throw new Error('cwd must be a string');
  const resolvedCwd = typeof cwd === 'string' ? await normalizeCwd(root, cwd) : undefined;

  return {
    name,
    type: 'stdio',
    command,
    ...(resolvedCommand ? { resolvedCommand } : {}),
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
    ...(typeof cwd === 'string' ? { cwd } : {}),
    ...(resolvedCwd ? { resolvedCwd } : {}),
  };
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  const parts = host.split('.');
  return parts.length === 4
    && parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)
    && Number(parts[0]) === 127;
}

function normalizeRemote(
  name: string,
  value: Record<string, unknown>,
): PluginPackageMcpServer {
  assertClosed(value, REMOTE_FIELDS);
  if (value.type !== 'streamable-http' && value.type !== 'sse') {
    throw new Error('type must be `streamable-http` or `sse`');
  }
  if (typeof value.url !== 'string' || !value.url) throw new Error('url must be a non-empty string');
  let parsed: URL;
  try {
    parsed = new URL(value.url);
  } catch {
    throw new Error('url must be an absolute HTTP or HTTPS URL');
  }
  const authority = value.url.slice(value.url.indexOf('://') + 3).split(/[/?#]/, 1)[0];
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || authority.includes('@')
    || value.url.includes('#')
  ) {
    throw new Error('url must be HTTP(S) without user information or a fragment');
  }
  if (parsed.protocol === 'http:' && !isLoopback(parsed.hostname)) {
    throw new Error('non-loopback MCP URLs must use HTTPS');
  }

  const headers = value.headers === undefined ? undefined : stringRecord(value.headers);
  if (headers === null) throw new Error('headers must be an object of strings');
  const seen = new Set<string>();
  for (const [headerName, headerValue] of Object.entries(headers ?? {})) {
    const key = headerName.toLowerCase();
    if (seen.has(key)) throw new Error(`duplicate header name \`${headerName}\``);
    seen.add(key);
    if (SENSITIVE_REMOTE_HEADERS.has(key)) {
      throw new Error(`header \`${headerName}\` must not contain credentials in package data`);
    }
    try {
      validateHeaderName(headerName);
      validateHeaderValue(headerName, headerValue);
    } catch {
      throw new Error(`invalid HTTP header \`${headerName}\``);
    }
  }
  return { name, type: value.type, url: value.url, ...(headers ? { headers } : {}) };
}

async function normalizeServer(
  root: string,
  name: string,
  value: unknown,
): Promise<PluginPackageMcpServer> {
  if (!isRecord(value)) throw new Error('server entry must be an object');
  return value.type === 'stdio'
    ? normalizeStdio(root, name, value)
    : normalizeRemote(name, value);
}

export async function readMcpComponent(
  root: string,
  diagnostics: PluginPackageDiagnostic[],
): Promise<PluginPackageMcpComponent | undefined> {
  const candidate = join(root, 'mcp.json');
  try {
    if (!await pathExists(candidate)) return undefined;
  } catch (error) {
    diagnostics.push(diagnostic('error', 'mcp', 'mcp.unreadable', errorMessage(error), candidate));
    return undefined;
  }
  let path: string;
  let raw: unknown;
  try {
    path = await containedRealpath(root, candidate);
    if (!(await fs.stat(path)).isFile()) throw new Error('mcp.json is not a regular file');
    raw = await readJson(path);
  } catch (error) {
    diagnostics.push(diagnostic('error', 'mcp', 'mcp.unreadable', errorMessage(error), candidate));
    return undefined;
  }

  if (
    !isRecord(raw)
    || raw.$schema !== AGENT_PLUGIN_MCP_V1_SCHEMA
    || !isRecord(raw.mcpServers)
    || Object.keys(raw).some((key) => key !== '$schema' && key !== 'mcpServers')
  ) {
    diagnostics.push(diagnostic(
      'error', 'mcp', 'mcp.invalid', 'mcp.json must match the closed Agent Plugins v1 schema', path,
    ));
    return undefined;
  }

  const servers: PluginPackageMcpServer[] = [];
  for (const [name, value] of Object.entries(raw.mcpServers)) {
    try {
      servers.push(await normalizeServer(root, name, value));
    } catch (error) {
      diagnostics.push(diagnostic(
        'error', 'mcp-server', 'mcp-server.invalid', errorMessage(error), path, name,
      ));
    }
  }
  return { path, servers };
}
