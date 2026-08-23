import { promises as fs } from 'fs';
import { join } from 'path';
import type { NormalizedPluginPackage, PluginPackageMcpServer } from '../../shared/plugin-market';
import { pluginMarketDataDir, pluginMarketRuntimeDir } from './store';

function safeDirectoryName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin';
}

function expandPluginVariables(value: string, root: string, dataDir: string): string {
  return value.replace(/\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g, (_placeholder, name: string) => (
    name === 'PLUGIN_ROOT' ? root : dataDir
  ));
}

function nativeServer(
  pluginId: string,
  server: PluginPackageMcpServer,
  root: string,
  dataDir: string,
): [string, Record<string, unknown>] {
  const name = `${pluginId}.${server.name}`;
  if (server.type === 'stdio') {
    const env = Object.fromEntries(
      Object.entries(server.env ?? {}).map(([key, value]) => [
        key,
        expandPluginVariables(value, root, dataDir),
      ]),
    );
    return [name, {
      transport: 'stdio',
      command: server.resolvedCommand ?? server.command,
      args: server.args?.map((arg) => expandPluginVariables(arg, root, dataDir)),
      env: { ...env, PLUGIN_ROOT: root, PLUGIN_DATA: dataDir },
      cwd: server.resolvedCwd
        ?? (server.cwd ? expandPluginVariables(server.cwd, root, dataDir) : root),
    }];
  }
  return [name, {
    transport: server.type === 'streamable-http' ? 'http' : 'sse',
    url: server.url,
    // Agent Plugins leaves OAuth discovery and credential storage to the
    // client. Supplying the Canvas provider is harmless for anonymous MCPs
    // and lets a 401 challenge start the standard browser flow.
    auth: 'oauth',
    ...(server.headers && Object.keys(server.headers).length > 0
      ? { headers: server.headers }
      : {}),
  }];
}

export async function writePluginMcpAdapter(
  listingId: string,
  plugin: NormalizedPluginPackage,
): Promise<string | undefined> {
  if (!plugin.mcp || plugin.mcp.servers.length === 0) return undefined;
  const directoryName = safeDirectoryName(listingId);
  const dataDir = join(pluginMarketDataDir(), directoryName);
  const runtimeDir = join(pluginMarketRuntimeDir(), directoryName);
  await Promise.all([
    fs.mkdir(dataDir, { recursive: true }),
    fs.mkdir(runtimeDir, { recursive: true }),
  ]);
  const servers = Object.fromEntries(
    plugin.mcp.servers.map((server) => nativeServer(
      safeDirectoryName(plugin.name),
      server,
      plugin.root,
      dataDir,
    )),
  );
  const path = join(runtimeDir, 'mcp.json');
  await fs.writeFile(path, `${JSON.stringify({ servers }, null, 2)}\n`, 'utf8');
  return path;
}
