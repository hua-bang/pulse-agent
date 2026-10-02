import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Fake MCP client tools shared with the hoisted module mock. `plain` has no
// description so we also cover the "description omitted" branch.
const { fakeTools, mcpCalls, serverBehaviour, createdClients, mcpResponses } = vi.hoisted(() => ({
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
  // Per-URL startup behaviour for concurrency / timeout tests.
  serverBehaviour: {} as Record<string, {
    connectDelayMs?: number;
    toolsDelayMs?: number;
    toolsError?: string;
    toolsHang?: boolean;
    tools?: Record<string, { description?: string }>;
  }>,
  createdClients: [] as Array<{ url?: string; close: ReturnType<typeof vi.fn> }>,
  mcpResponses: {
    resource: { contents: [{ uri: 'ui://exa/search.html', text: '<main>app</main>' }] } as unknown,
  },
}));

vi.mock('@ai-sdk/mcp', () => ({
  createMCPClient: vi.fn(async (config) => {
    mcpCalls.push(config);
    const url = config?.transport?.url as string | undefined;
    const behaviour = (url && serverBehaviour[url]) || {};
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    if (behaviour.connectDelayMs) await sleep(behaviour.connectDelayMs);
    const close = vi.fn();
    createdClients.push({ url, close });
    return {
      tools: async () => {
        if (behaviour.toolsHang) return new Promise(() => undefined);
        if (behaviour.toolsDelayMs) await sleep(behaviour.toolsDelayMs);
        if (behaviour.toolsError) throw new Error(behaviour.toolsError);
        return behaviour.tools ?? fakeTools;
      },
      listResources: vi.fn(async () => ({ resources: [] })),
      readResource: vi.fn(async () => mcpResponses.resource),
      close,
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
  createdClients.length = 0;
  for (const key of Object.keys(serverBehaviour)) delete serverBehaviour[key];
  mcpResponses.resource = {
    contents: [{ uri: 'ui://exa/search.html', text: '<main>app</main>' }],
  };
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createMcpPlugin MCP App entrypoints', () => {
  it('parses namespaced entrypoints and titles for app tools', async () => {
    const cfgPath = await writeConfig({
      cad: { transport: 'http', url: 'https://cad.example/mcp' },
    });
    serverBehaviour['https://cad.example/mcp'] = {
      tools: {
        library: {
          title: 'Parts Library',
          _meta: {
            ui: { resourceUri: 'ui://cad/app' },
            'openai/ui': { entrypoints: [{ type: 'global', quickAction: { title: 'Ref' } }, { bad: true }] },
            'pulse/ui': { entrypoints: [{ type: 'node', nodeType: 'cad.library' }] },
            'openai/iconStyle': 'monochrome',
          },
        } as any,
        tray: {
          annotations: { title: 'Tray' },
          _meta: { ui: { resourceUri: 'ui://cad/app' } },
        } as any,
      },
    };

    const plugin = createMcpPlugin({ configPaths: [cfgPath] });
    const { ctx, services } = makeContext();
    await plugin.initialize(ctx);

    const apps = services['mcp:__apps__'] as MCPAppsManager;
    expect(apps.listToolApps()).toEqual([
      {
        serverName: 'cad',
        toolName: 'library',
        registeredToolName: 'mcp_cad_library',
        resourceUri: 'ui://cad/app',
        title: 'Parts Library',
        entrypoints: [
          { namespace: 'openai/ui', type: 'global', options: { quickAction: { title: 'Ref' } } },
          { namespace: 'pulse/ui', type: 'node', options: { nodeType: 'cad.library' } },
        ],
      },
      {
        serverName: 'cad',
        toolName: 'tray',
        registeredToolName: 'mcp_cad_tray',
        resourceUri: 'ui://cad/app',
        title: 'Tray',
      },
    ]);
  });
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
    expect(tools['mcp_eido_search']).toMatchObject({ codemode: true });
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

    expect(tools['mcp_eido_search']).toMatchObject({ codemode: true });
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

  it('allows bundled MCP App resources up to 16 MiB while retaining the smaller tool-result limit', async () => {
    const cfgPath = await writeConfig({
      eido: { transport: 'http', url: 'http://localhost:3060/mcp/server' },
    });
    const largePayload = 'x'.repeat(2 * 1024 * 1024 + 1);
    mcpResponses.resource = {
      contents: [{ uri: 'ui://exa/search.html', text: largePayload }],
    };

    const plugin = createMcpPlugin({ configPaths: [cfgPath] });
    const { ctx, services } = makeContext();
    await plugin.initialize(ctx);

    const apps = services['mcp:__apps__'] as MCPAppsManager;
    await expect(apps.readResource('eido', 'ui://exa/search.html')).resolves.toMatchObject({
      contents: [{ text: largePayload }],
    });

    apps.captureToolResult('mcp_eido_search', 'large-result', {
      structuredContent: { payload: largePayload },
    });
    expect(apps.getToolResult('large-result')).toMatchObject({
      isError: true,
      content: [{ text: 'MCP App result exceeded the 2 MiB host limit' }],
    });

    mcpResponses.resource = {
      contents: [{ uri: 'ui://exa/search.html', text: 'x'.repeat(16 * 1024 * 1024 + 1) }],
    };
    await expect(apps.readResource('eido', 'ui://exa/search.html'))
      .rejects.toThrow('MCP resource exceeded the 16 MiB host limit');
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

describe('createMcpPlugin startup timing', () => {
  it('emits one mcpServerTiming per configured server, including failures', async () => {
    const cfgPath = await writeConfig({
      exa: { transport: 'http', url: 'https://mcp.exa.ai/mcp' },
      broken: { transport: 'http' },
    });
    const plugin = createMcpPlugin({ configPaths: [cfgPath] });
    const { ctx } = makeContext();
    const emitted: Array<[string, any]> = [];
    ctx.events = { emit: (name: string, payload: unknown) => emitted.push([name, payload]), on: () => {} } as any;

    await plugin.initialize(ctx);

    const timings = emitted.filter(([name]) => name === 'mcpServerTiming').map(([, payload]) => payload);
    expect(timings.map(timing => timing.serverName).sort()).toEqual(['broken', 'exa']);
    const exa = timings.find(timing => timing.serverName === 'exa');
    expect(exa).toMatchObject({ ok: true });
    expect(exa.connectMs).toBeGreaterThanOrEqual(0);
    expect(exa.listToolsMs).toBeGreaterThanOrEqual(0);
    expect(exa.durationMs).toBeGreaterThanOrEqual(exa.connectMs + exa.listToolsMs);
    expect(timings.find(timing => timing.serverName === 'broken')).toMatchObject({ ok: false });
  });
});

describe('createMcpPlugin parallel startup', () => {
  const url = (name: string) => `https://${name}.example.com/mcp`;

  it('starts servers concurrently so startup costs the slowest server, not the sum', async () => {
    const cfgPath = await writeConfig({
      a: { transport: 'http', url: url('a') },
      b: { transport: 'http', url: url('b') },
      c: { transport: 'http', url: url('c') },
    });
    for (const name of ['a', 'b', 'c']) serverBehaviour[url(name)] = { connectDelayMs: 150 };
    const plugin = createMcpPlugin({ configPaths: [cfgPath] });
    const { ctx } = makeContext();

    const startedAt = Date.now();
    await plugin.initialize(ctx);

    // Serial startup would take >= 450ms.
    expect(Date.now() - startedAt).toBeLessThan(400);
  });

  it('registers tools in config order regardless of which server finishes first', async () => {
    const cfgPath = await writeConfig({
      slow: { transport: 'http', url: url('slow') },
      fast: { transport: 'http', url: url('fast') },
    });
    serverBehaviour[url('slow')] = { connectDelayMs: 80, tools: { one: {} } };
    serverBehaviour[url('fast')] = { tools: { two: {} } };
    const plugin = createMcpPlugin({ configPaths: [cfgPath] });
    const { ctx, tools } = makeContext();

    await plugin.initialize(ctx);

    expect(Object.keys(tools)).toEqual(['mcp_slow_one', 'mcp_fast_two']);
  });

  it('fails a server that exceeds its startup budget and closes its client when it arrives late', async () => {
    const cfgPath = await writeConfig({
      hung: { transport: 'http', url: url('hung'), startupTimeoutMs: 30 },
      ok: { transport: 'http', url: url('ok') },
    });
    serverBehaviour[url('hung')] = { connectDelayMs: 120 };
    serverBehaviour[url('ok')] = { tools: { ping: {} } };
    const plugin = createMcpPlugin({ configPaths: [cfgPath], startupTimeoutMs: 5_000 });
    const { ctx, tools, services } = makeContext();

    await plugin.initialize(ctx);

    const statuses = (services['mcp:__manager__'] as MCPClientManager).getStatuses();
    expect(statuses.hung).toMatchObject({ ok: false });
    expect((statuses.hung as { error: string }).error).toMatch(/timed out after 30ms/);
    expect(statuses.ok).toMatchObject({ ok: true, toolCount: 1 });
    expect(Object.keys(tools)).toEqual(['mcp_ok_ping']);

    await vi.waitFor(() => {
      const late = createdClients.find(client => client.url === url('hung'));
      expect(late?.close).toHaveBeenCalled();
    });
  });

  it('closes a connected client whose tools/list never answers once its budget expires', async () => {
    const cfgPath = await writeConfig({ stuck: { transport: 'http', url: url('stuck'), startupTimeoutMs: 30 } });
    serverBehaviour[url('stuck')] = { toolsHang: true };
    const plugin = createMcpPlugin({ configPaths: [cfgPath] });
    const { ctx, services } = makeContext();

    await plugin.initialize(ctx);

    expect((services['mcp:__manager__'] as MCPClientManager).getStatuses().stuck).toMatchObject({ ok: false });
    await vi.waitFor(() => expect(createdClients[0].close).toHaveBeenCalled());
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back to the default budget for an invalid plugin-level startupTimeoutMs (%s)',
    async (startupTimeoutMs) => {
      const cfgPath = await writeConfig({ a: { transport: 'http', url: url('a') } });
      serverBehaviour[url('a')] = { connectDelayMs: 20 };
      const plugin = createMcpPlugin({ configPaths: [cfgPath], startupTimeoutMs });
      const { ctx, services } = makeContext();

      await plugin.initialize(ctx);

      expect((services['mcp:__manager__'] as MCPClientManager).getStatuses().a).toMatchObject({ ok: true });
    },
  );

  it('closes the client when listing tools fails', async () => {
    const cfgPath = await writeConfig({ broken: { transport: 'http', url: url('broken') } });
    serverBehaviour[url('broken')] = { toolsError: 'tools/list failed' };
    const plugin = createMcpPlugin({ configPaths: [cfgPath] });
    const { ctx, services } = makeContext();

    await plugin.initialize(ctx);

    expect((services['mcp:__manager__'] as MCPClientManager).getStatuses().broken)
      .toEqual({ ok: false, error: 'tools/list failed' });
    await vi.waitFor(() => expect(createdClients[0].close).toHaveBeenCalled());
  });

  it('ignores an invalid startupTimeoutMs and keeps the default budget', async () => {
    const cfgPath = await writeConfig({ a: { transport: 'http', url: url('a'), startupTimeoutMs: -1 } });
    const plugin = createMcpPlugin({ configPaths: [cfgPath] });
    const { ctx, services } = makeContext();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await plugin.initialize(ctx);

    expect((services['mcp:__manager__'] as MCPClientManager).getStatuses().a).toMatchObject({ ok: true });
    expect(warn.mock.calls.some(([message]) => String(message).includes('invalid startupTimeoutMs'))).toBe(true);
    warn.mockRestore();
  });
});
