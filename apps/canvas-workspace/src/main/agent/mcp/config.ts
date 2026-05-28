/**
 * Canvas MCP server storage — read/write/validate `mcp.json` for a scope.
 *
 * The file format matches the engine MCP plugin's schema
 * (`{ servers: { <name>: { transport, ... } } }`) so the engine loads these
 * files directly. Validation here mirrors the plugin's normalizer, surfaced
 * as thrown errors so the settings UI can show what's wrong.
 */

import { promises as fs } from 'fs';
import { dirname } from 'path';
import { scopeMcpConfigPath, type CanvasConfigScope } from '../config-scope';

export type CanvasMcpTransport = 'http' | 'sse' | 'stdio';

export interface CanvasMcpServer {
  name: string;
  transport: CanvasMcpTransport;
  /** http/sse */
  url?: string;
  headers?: Record<string, string>;
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  deferTools?: boolean;
}

export interface CanvasMcpStatus {
  scope: 'global' | 'workspace';
  path: string;
  servers: CanvasMcpServer[];
}

interface McpFileShape {
  servers?: Record<string, Record<string, unknown>>;
}

function normalizeStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    const key = normalizeStr(k);
    const val = typeof v === 'string' ? v : '';
    if (key) out[key] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === 'string');
  return out.length > 0 ? out : undefined;
}

/** Normalize + validate a single server; throws on invalid input. */
function normalizeServer(server: CanvasMcpServer): { name: string; config: Record<string, unknown> } {
  const name = normalizeStr(server.name);
  if (!name) throw new Error('MCP server name is required');

  const transport = normalizeStr(server.transport).toLowerCase() as CanvasMcpTransport;
  if (transport !== 'http' && transport !== 'sse' && transport !== 'stdio') {
    throw new Error(`Unsupported transport "${server.transport}" for server "${name}"`);
  }

  const config: Record<string, unknown> = { transport };
  if (server.deferTools === true) config.deferTools = true;

  if (transport === 'http' || transport === 'sse') {
    const url = normalizeStr(server.url);
    if (!url) throw new Error(`Server "${name}" requires a URL for ${transport} transport`);
    config.url = url;
    const headers = normalizeStringMap(server.headers);
    if (headers) config.headers = headers;
  } else {
    const command = normalizeStr(server.command);
    if (!command) throw new Error(`Server "${name}" requires a command for stdio transport`);
    config.command = command;
    const args = normalizeStringArray(server.args);
    if (args) config.args = args;
    const env = normalizeStringMap(server.env);
    if (env) config.env = env;
    const cwd = normalizeStr(server.cwd);
    if (cwd) config.cwd = cwd;
  }

  return { name, config };
}

/** Parse a stored server record back into the UI-facing shape. */
function readServer(name: string, raw: Record<string, unknown>): CanvasMcpServer {
  const transport = (normalizeStr(raw.transport).toLowerCase() || 'http') as CanvasMcpTransport;
  const server: CanvasMcpServer = { name, transport };
  if (raw.deferTools === true) server.deferTools = true;
  if (transport === 'stdio') {
    server.command = normalizeStr(raw.command);
    const args = normalizeStringArray(raw.args);
    if (args) server.args = args;
    const env = normalizeStringMap(raw.env);
    if (env) server.env = env;
    const cwd = normalizeStr(raw.cwd);
    if (cwd) server.cwd = cwd;
  } else {
    server.url = normalizeStr(raw.url);
    const headers = normalizeStringMap(raw.headers);
    if (headers) server.headers = headers;
  }
  return server;
}

async function readFile(scope: CanvasConfigScope): Promise<McpFileShape> {
  const path = scopeMcpConfigPath(scope);
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return { servers: {} };
    const servers = (parsed as McpFileShape).servers;
    return { servers: servers && typeof servers === 'object' ? servers : {} };
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { servers: {} };
    throw err;
  }
}

async function writeFile(scope: CanvasConfigScope, file: McpFileShape): Promise<void> {
  const path = scopeMcpConfigPath(scope);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

export async function getCanvasMcpStatus(scope: CanvasConfigScope): Promise<CanvasMcpStatus> {
  const file = await readFile(scope);
  const servers = Object.entries(file.servers ?? {}).map(([name, raw]) => readServer(name, raw));
  servers.sort((a, b) => a.name.localeCompare(b.name));
  return { scope: scope.level, path: scopeMcpConfigPath(scope), servers };
}

export async function upsertCanvasMcpServer(
  scope: CanvasConfigScope,
  server: CanvasMcpServer,
  originalName?: string,
): Promise<CanvasMcpStatus> {
  const { name, config } = normalizeServer(server);
  const file = await readFile(scope);
  const servers = { ...(file.servers ?? {}) };
  const prev = normalizeStr(originalName);
  if (prev && prev !== name) delete servers[prev];
  servers[name] = config;
  await writeFile(scope, { servers });
  return getCanvasMcpStatus(scope);
}

export async function removeCanvasMcpServer(
  scope: CanvasConfigScope,
  name: string,
): Promise<CanvasMcpStatus> {
  const key = normalizeStr(name);
  const file = await readFile(scope);
  const servers = { ...(file.servers ?? {}) };
  delete servers[key];
  await writeFile(scope, { servers });
  return getCanvasMcpStatus(scope);
}
