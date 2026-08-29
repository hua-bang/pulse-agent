import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Fake MCP client tools shared with the hoisted module mock. `plain` has no
// description so we also cover the "description omitted" branch.
const { fakeTools, mcpCalls } = vi.hoisted(() => ({
  fakeTools: {
    search: {
      description: 'Search the web',
      _meta: { ui: { resourceUri: 'ui://exa/search.html' } },
      execute: vi.fn(async (args) => ({ content: [], structuredContent: args })),
    },
    danger_tool: { description: 'Dangerous operation' },
    plain: {},
  } as Record<string, { description?: string }>,
  mcpCalls: [] as any[],
}));

vi.mock('@ai-sdk/mcp', () => ({
  createMCPClient: vi.fn(async (config) => {
    mcpCalls.push(config);
    return {
      tools: async () => fakeTools,
      listResources: vi.fn(async () => ({ resources: [] })),
      readResource: vi.fn(async ({ uri }) => ({ contents: [{ uri, text: '<main>app</main>' }] })),
      close: vi.fn(),
    };
  }),
}));

vi.mock('@ai-sdk/mcp/mcp-stdio', () => ({
  Experimental_StdioMCPTransport: class {},
}));

import { createMcpPlugin, type MCPAppsManager, type MCPClientManager } from './index';
import type { EnginePluginContext } from '../../plugin/EnginePlugin';

/** Minimal EnginePluginContext that records registered tools + services. */
function makeContext() {
  const tools: Record<string, any> = {};
  const services: Record<string, any> = {};
  const ctx: EnginePluginContext = {
    registerTool: (name, tool) => {
      tools[name] = tool;
    },
    registerTools: (map) => {
      Object.assign(tools, map);
    },
    getTool: (name) => tools[name],
    getTools: () => ({ ...tools }),
    getEngineInstance: () => ({}) as any,
    registerHook: () => {},
    registerService: (name, service) => {
      services[name] = service;
    },
    getService: (name) => services[name],
    getConfig: () => undefined,
    setConfig: () => {},
    events: { emit: () => {}, on: () => {} } as any,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
  return { ctx, tools, services };
}

let dir: string;
async function writeConfig(servers: Record<string, unknown>): Promise<string> {
  const cfgPath = join(dir, 'mcp.json');
  await fs.writeFile(cfgPath, JSON.stringify({ servers }), 'utf8');
  return cfgPath;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'mcp-plugin-test-'));
  mcpCalls.length = 0;
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createMcpPlugin disabledTools', () => {
  it('registers provider-safe tool names when an MCP server name contains punctuation', async () => {
    const cfgPath = await writeConfig({
      'exa.exa': { transport: 'http', url: 'https://mcp.exa.ai/mcp' },
    });
    fakeTools['web.search'] = { description: 'Search with punctuation' };

    try {
      const plugin = createMcpPlugin({ configPaths: [cfgPath] });
      const { ctx, tools } = makeContext();
      await plugin.initialize(ctx);

      expect(Object.keys(tools)).toContain('mcp_exa_exa_search');
      expect(Object.keys(tools)).toContain('mcp_exa_exa_web_search');
      expect(Object.keys(tools).every((name) => /^[a-zA-Z0-9_-]+$/.test(name))).toBe(true);
    } finally {
      delete fakeTools['web.search'];
    }
  });

  it('skips registering disabled tools but still lists them in the status', async () => {
    const cfgPath = await writeConfig({
      eido: {
        transport: 'http',
        url: 'http://localhost:3060/mcp/server',
        disabledTools: ['danger_tool'],
      },
    });

    const plugin = createMcpPlugin({ configPaths: [cfgPath] });
    const { ctx, tools, services } = makeContext();
    await plugin.initialize(ctx);

    // Disabled tool is not registered with the engine; the agent can't see it.
    expect(tools['mcp_eido_danger_tool']).toBeUndefined();
    // Enabled tools are registered under the namespaced key.
    expect(tools['mcp_eido_search']).toBeDefined();
    expect(tools['mcp_eido_plain']).toBeDefined();

    const manager = services['mcp:__manager__'] as MCPClientManager;
    const status = manager.getStatuses()['eido'];
    expect(status.ok).toBe(true);
    if (status.ok) {
      // toolCount reflects only the enabled (registered) tools.
      expect(status.toolCount).toBe(2);
      const byName = Object.fromEntries(status.tools.map((t) => [t.name, t]));
      expect(byName.search).toMatchObject({ enabled: true, description: 'Search the web' });
      expect(byName.danger_tool).toMatchObject({ enabled: false, description: 'Dangerous operation' });
      expect(byName.plain).toMatchObject({ enabled: true });
      expect(byName.plain.description).toBeUndefined();
    }
  });

  it('registers every tool when nothing is disabled', async () => {
    const cfgPath = await writeConfig({
      eido: { transport: 'http', url: 'http://localhost:3060/mcp/server' },
    });

    const plugin = createMcpPlugin({ configPaths: [cfgPath] });
    const { ctx, tools, services } = makeContext();
    await plugin.initialize(ctx);

    expect(tools['mcp_eido_search']).toBeDefined();
    expect(tools['mcp_eido_danger_tool']).toBeDefined();
    expect(tools['mcp_eido_plain']).toBeDefined();

    const manager = services['mcp:__manager__'] as MCPClientManager;
    const status = manager.getStatuses()['eido'];
    expect(status.ok && status.toolCount).toBe(3);
    if (status.ok) {
      expect(status.tools.every((t) => t.enabled)).toBe(true);
    }

    const apps = services['mcp:__apps__'] as MCPAppsManager;
    expect(apps.getToolApp('mcp_eido_search')).toEqual({
      serverName: 'eido',
      toolName: 'search',
      registeredToolName: 'mcp_eido_search',
      resourceUri: 'ui://exa/search.html',
    });
    expect(apps.getRegisteredToolName('eido', 'plain')).toBe('mcp_eido_plain');
    await expect(apps.readResource('eido', 'ui://exa/search.html')).resolves.toMatchObject({
      contents: [{ text: '<main>app</main>' }],
    });
    const appResult = await tools['mcp_eido_search'].execute(
      { query: 'pulse' },
      { toolCallId: 'app-call-1' },
    );
    expect(appResult).toMatchObject({
      structuredContent: { query: 'pulse' },
    });
    apps.captureToolResult('mcp_eido_search', 'app-call-1', appResult);
    expect(apps.getToolResult('app-call-1')).toMatchObject({
      structuredContent: { query: 'pulse' },
    });
  });

  it('attaches an OAuth authProvider for oauth-enabled http servers', async () => {
    const cfgPath = await writeConfig({
      figma: {
        transport: 'http',
        url: 'https://mcp.figma.com/mcp',
        auth: 'oauth',
      },
    });
    const authProvider = { marker: 'oauth-provider' } as any;
    const authProviderFactory = vi.fn(async ({ serverName, config }) => {
      expect(serverName).toBe('figma');
      expect(config.auth).toBe('oauth');
      return authProvider;
    });

    const plugin = createMcpPlugin({ configPaths: [cfgPath], authProviderFactory });
    const { ctx } = makeContext();
    await plugin.initialize(ctx);

    expect(authProviderFactory).toHaveBeenCalledTimes(1);
    expect(mcpCalls[0].transport).toMatchObject({
      type: 'http',
      url: 'https://mcp.figma.com/mcp',
      authProvider,
    });
  });
});
