import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

// Sandbox `os.homedir()` to a temp dir BEFORE the modules under test load —
// `config-scope.ts` computes `CANVAS_STORE_DIR` from `homedir()` at module
// eval time. Mirrors the pattern in `default-skills.test.ts`.
const { sandboxHome } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}canvas-mcp-config-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

import {
  getCanvasMcpStatus,
  importCanvasMcpJson,
  setCanvasMcpToolEnabled,
  upsertCanvasMcpServer,
} from '../config';

const GLOBAL = { level: 'global' } as const;
const mcpPath = join(sandboxHome, '.pulse-coder', 'canvas', 'mcp.json');

async function readRaw(): Promise<any> {
  return JSON.parse(await fs.readFile(mcpPath, 'utf8'));
}

beforeEach(async () => {
  await fs.mkdir(join(sandboxHome, '.pulse-coder', 'canvas'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(join(sandboxHome, '.pulse-coder'), { recursive: true, force: true });
});

describe('disabledTools persistence', () => {
  it('round-trips OAuth config through upsert and status', async () => {
    await upsertCanvasMcpServer(GLOBAL, {
      name: 'figma',
      transport: 'http',
      url: 'https://mcp.figma.com/mcp',
      auth: 'oauth',
      oauth: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        scope: 'files:read',
      },
    });

    const status = await getCanvasMcpStatus(GLOBAL);
    const server = status.servers.find((s) => s.name === 'figma');
    expect(server?.auth).toBe('oauth');
    expect(server?.oauth).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: 'files:read',
    });

    const raw = await readRaw();
    expect(raw.servers.figma.auth).toBe('oauth');
    expect(raw.servers.figma.oauth).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: 'files:read',
    });
  });

  it('keeps OAuth off stdio servers', async () => {
    await upsertCanvasMcpServer(GLOBAL, {
      name: 'local',
      transport: 'stdio',
      command: 'node',
      auth: 'oauth',
      oauth: {
        clientId: 'ignored',
      },
    });

    const raw = await readRaw();
    expect(raw.servers.local.transport).toBe('stdio');
    expect('auth' in raw.servers.local).toBe(false);
    expect('oauth' in raw.servers.local).toBe(false);
  });

  it('round-trips disabledTools through upsert and status', async () => {
    await upsertCanvasMcpServer(GLOBAL, {
      name: 'eido',
      transport: 'http',
      url: 'http://localhost:3060/mcp/server',
      disabledTools: ['danger_tool', 'noisy_tool'],
    });

    const status = await getCanvasMcpStatus(GLOBAL);
    const server = status.servers.find((s) => s.name === 'eido');
    expect(server?.disabledTools).toEqual(['danger_tool', 'noisy_tool']);

    // Stored on disk in the engine-compatible shape.
    const raw = await readRaw();
    expect(raw.servers.eido.disabledTools).toEqual(['danger_tool', 'noisy_tool']);
  });

  it('drops an empty disabledTools list rather than persisting it', async () => {
    await upsertCanvasMcpServer(GLOBAL, {
      name: 'eido',
      transport: 'http',
      url: 'http://localhost:3060/mcp/server',
      disabledTools: [],
    });
    const raw = await readRaw();
    expect('disabledTools' in raw.servers.eido).toBe(false);
  });
});

describe('setCanvasMcpToolEnabled', () => {
  beforeEach(async () => {
    await upsertCanvasMcpServer(GLOBAL, {
      name: 'eido',
      transport: 'http',
      url: 'http://localhost:3060/mcp/server',
    });
  });

  it('disabling a tool adds it to disabledTools', async () => {
    await setCanvasMcpToolEnabled(GLOBAL, 'eido', 'search', false);
    const raw = await readRaw();
    expect(raw.servers.eido.disabledTools).toEqual(['search']);
  });

  it('keeps the disabled set sorted and de-duplicated', async () => {
    await setCanvasMcpToolEnabled(GLOBAL, 'eido', 'zeta', false);
    await setCanvasMcpToolEnabled(GLOBAL, 'eido', 'alpha', false);
    await setCanvasMcpToolEnabled(GLOBAL, 'eido', 'zeta', false);
    const raw = await readRaw();
    expect(raw.servers.eido.disabledTools).toEqual(['alpha', 'zeta']);
  });

  it('re-enabling the last disabled tool clears the field entirely', async () => {
    await setCanvasMcpToolEnabled(GLOBAL, 'eido', 'search', false);
    await setCanvasMcpToolEnabled(GLOBAL, 'eido', 'search', true);
    const raw = await readRaw();
    expect('disabledTools' in raw.servers.eido).toBe(false);
  });

  it('does not touch unrelated server fields', async () => {
    await setCanvasMcpToolEnabled(GLOBAL, 'eido', 'search', false);
    const raw = await readRaw();
    expect(raw.servers.eido.url).toBe('http://localhost:3060/mcp/server');
    expect(raw.servers.eido.transport).toBe('http');
  });

  it('throws when the server does not exist', async () => {
    await expect(setCanvasMcpToolEnabled(GLOBAL, 'ghost', 'search', false)).rejects.toThrow(/not found/);
  });
});

describe('importCanvasMcpJson', () => {
  it('carries OAuth config through native-shape import', async () => {
    const json = JSON.stringify({
      servers: {
        figma: {
          transport: 'http',
          url: 'https://mcp.figma.com/mcp',
          auth: 'oauth',
          oauth: {
            scope: 'files:read',
          },
        },
      },
    });
    await importCanvasMcpJson(GLOBAL, json);
    const raw = await readRaw();
    expect(raw.servers.figma.auth).toBe('oauth');
    expect(raw.servers.figma.oauth).toEqual({ scope: 'files:read' });
  });

  it('carries disabledTools through native-shape import', async () => {
    const json = JSON.stringify({
      servers: {
        eido: {
          transport: 'http',
          url: 'http://localhost:3060/mcp/server',
          disabledTools: ['danger_tool'],
        },
      },
    });
    await importCanvasMcpJson(GLOBAL, json);
    const raw = await readRaw();
    expect(raw.servers.eido.disabledTools).toEqual(['danger_tool']);
  });
});
