import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';

// Pin os.homedir() to a sandbox BEFORE control-server computes RUNTIME_DIR /
// RUNTIME_FILE at module load, so the runtime file lands in a temp location.
const { sandboxHome } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}control-server-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

// control-server only touches `app.once('will-quit', ...)` in the lifecycle
// paths under test; stub it so importing electron does not blow up in node.
vi.mock('electron', () => ({
  app: { once: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

// These are only used by the HTTP request handlers, not the lifecycle code we
// exercise here. Stub them so the module imports cleanly.
vi.mock('../../agent/session-send', () => ({ sendInputToAgentNode: vi.fn() }));
vi.mock('../../agent-teams/service', () => ({ getCanvasAgentTeamsService: vi.fn() }));

import {
  startRuntimeControlServer,
  stopRuntimeControlServer,
  ensureRuntimeControlServer,
  RUNTIME_FILE_PATH,
  __test,
} from '../control-server';
import { readCanvasFull, writeCanvasFull } from '../../canvas/storage';
import { getCanvasCapabilityRuntime } from '../capabilities';
import { createHostRendererCapabilities } from '../capabilities/host-renderer-capabilities';

for (const capability of createHostRendererCapabilities()) {
  getCanvasCapabilityRuntime().register(capability);
}

interface RuntimeInfo {
  pid: number;
  baseUrl: string;
  secret: string;
  createdAt: string;
}

async function readRuntimeFile(): Promise<RuntimeInfo> {
  return JSON.parse(await fs.readFile(RUNTIME_FILE_PATH, 'utf-8')) as RuntimeInfo;
}

async function fileExists(): Promise<boolean> {
  try {
    await fs.access(RUNTIME_FILE_PATH);
    return true;
  } catch {
    return false;
  }
}

async function setCapabilityRuntimeEnabled(
  enabled: boolean,
  pageControlEnabled = false,
): Promise<void> {
  const flagPath = `${sandboxHome}/.pulse-coder/canvas/experimental-features.json`;
  await fs.mkdir(`${sandboxHome}/.pulse-coder/canvas`, { recursive: true });
  await fs.writeFile(flagPath, JSON.stringify({
    'agent-runtime-control': enabled,
    'webview-page-control': pageControlEnabled,
  }));
}

async function postRuntime(
  runtime: RuntimeInfo,
  path: string,
  body: object,
  secret = runtime.secret,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${runtime.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

describe('runtime-control server lifecycle', () => {
  beforeEach(async () => {
    await fs.rm(__test.RUNTIME_DIR, { recursive: true, force: true });
    await setCapabilityRuntimeEnabled(false);
  });

  afterEach(async () => {
    // Always release the loopback port and clear module state between tests.
    await stopRuntimeControlServer();
    await fs.rm(__test.RUNTIME_DIR, { recursive: true, force: true });
    await fs.rm(`${sandboxHome}/.pulse-coder/canvas/ws-runtime`, { recursive: true, force: true });
  });

  it('writes a runtime file describing the live server', async () => {
    const handle = await startRuntimeControlServer();
    expect(handle.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const info = await readRuntimeFile();
    expect(info.pid).toBe(process.pid);
    expect(info.baseUrl).toBe(handle.baseUrl);
    expect(info.secret).toHaveLength(64); // 32 random bytes as hex
  });

  it('removes the runtime file on stop when it still owns it', async () => {
    await startRuntimeControlServer();
    expect(await fileExists()).toBe(true);

    await stopRuntimeControlServer();
    expect(await fileExists()).toBe(false);
  });

  it('does not delete the runtime file when a sibling instance owns it', async () => {
    await startRuntimeControlServer();

    // Simulate a second instance overwriting the file with its own live pid.
    const foreign: RuntimeInfo = {
      pid: 2147483646,
      baseUrl: 'http://127.0.0.1:65000',
      secret: 'sibling-secret',
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(RUNTIME_FILE_PATH, JSON.stringify(foreign));

    await stopRuntimeControlServer();

    // The sibling's file must survive — deleting it would strand that instance.
    expect(await fileExists()).toBe(true);
    const info = await readRuntimeFile();
    expect(info.pid).toBe(foreign.pid);
  });

  it('re-creates the runtime file if it vanishes while the server is alive', async () => {
    const handle = await startRuntimeControlServer();
    const before = await readRuntimeFile();

    // Something deleted the file out from under the still-listening server.
    await fs.rm(RUNTIME_FILE_PATH, { force: true });
    expect(await fileExists()).toBe(false);

    // Re-entry self-heals it without starting a second server.
    const healed = await ensureRuntimeControlServer();
    expect(healed).toBe(true);
    expect(await fileExists()).toBe(true);

    const after = await readRuntimeFile();
    expect(after.baseUrl).toBe(before.baseUrl); // same server, same port
    expect(after.pid).toBe(process.pid);
    expect(handle.baseUrl).toBe(after.baseUrl);
  });

  it('ensureRuntimeControlServer is idempotent (no second server)', async () => {
    const first = await ensureRuntimeControlServer();
    const baseUrl1 = (await readRuntimeFile()).baseUrl;

    const second = await ensureRuntimeControlServer();
    const baseUrl2 = (await readRuntimeFile()).baseUrl;

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(baseUrl2).toBe(baseUrl1);
  });

  it('keeps capability routes hidden until the experimental flag is enabled', async () => {
    await startRuntimeControlServer();
    const runtime = await readRuntimeFile();

    const response = await postRuntime(runtime, '/capabilities/list', {});
    expect(response).toEqual({ status: 404, body: { ok: false, error: 'not found' } });
  });

  it('lists and calls allowlisted capabilities over the authenticated runtime', async () => {
    await setCapabilityRuntimeEnabled(true);
    await startRuntimeControlServer();
    const runtime = await readRuntimeFile();

    const unauthorized = await postRuntime(runtime, '/capabilities/list', {}, 'wrong');
    expect(unauthorized.status).toBe(401);

    const listed = await postRuntime(runtime, '/capabilities/list', {});
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      ok: true,
      capabilities: expect.arrayContaining([
        expect.objectContaining({ name: 'browser.tabs.list', risk: 'read' }),
        expect.objectContaining({
          name: 'browser.tabs.open',
          risk: 'operate',
          inputSchema: expect.objectContaining({ type: 'object' }),
        }),
        expect.objectContaining({ name: 'browser.page.read', risk: 'read' }),
        expect.objectContaining({ name: 'canvas.nodes.read', risk: 'read' }),
        expect.objectContaining({ name: 'canvas.nodes.search', risk: 'read' }),
        expect.objectContaining({ name: 'canvas.nodes.update', risk: 'operate' }),
        expect.objectContaining({ name: 'host.renderer.eval', risk: 'unsafe' }),
      ]),
    });
    expect(listed.body.capabilities).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'browser.page.click' }),
      expect.objectContaining({ name: 'browser.page.fill' }),
      expect.objectContaining({ name: 'browser.page.eval' }),
    ]));

    const called = await postRuntime(runtime, '/capabilities/call', {
      workspaceId: 'ws-1',
      name: 'browser.tabs.list',
      input: {},
    });
    expect(called).toEqual({
      status: 200,
      body: { ok: true, value: { count: 0, tabs: [] } },
    });

    const hostEvalValidation = await postRuntime(runtime, '/capabilities/call', {
      workspaceId: 'ws-1',
      name: 'host.renderer.eval',
      input: {},
    });
    expect(hostEvalValidation).toMatchObject({
      status: 400,
      body: { ok: false, error: { code: 'invalid_input' } },
    });
  });

  it('reacts to page-control flag changes in both discovery and execution', async () => {
    await setCapabilityRuntimeEnabled(true, true);
    await startRuntimeControlServer();
    const runtime = await readRuntimeFile();

    const enabled = await postRuntime(runtime, '/capabilities/list', {});
    expect(enabled.body.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'browser.page.click' }),
      expect.objectContaining({ name: 'browser.page.fill' }),
      expect.objectContaining({ name: 'browser.page.eval', risk: 'unsafe' }),
    ]));
    const evalValidation = await postRuntime(runtime, '/capabilities/call', {
      workspaceId: 'ws-1',
      name: 'browser.page.eval',
      input: {},
    });
    expect(evalValidation).toMatchObject({
      status: 400,
      body: { ok: false, error: { code: 'invalid_input' } },
    });

    await setCapabilityRuntimeEnabled(true, false);
    const disabled = await postRuntime(runtime, '/capabilities/list', {});
    expect(disabled.body.capabilities).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'browser.page.click' }),
      expect.objectContaining({ name: 'browser.page.fill' }),
      expect.objectContaining({ name: 'browser.page.eval' }),
    ]));
    const forbidden = await postRuntime(runtime, '/capabilities/call', {
      workspaceId: 'ws-1',
      name: 'browser.page.fill',
      input: { nodeId: 'web-1', selector: 'input', value: 'blocked' },
    });
    expect(forbidden).toMatchObject({
      status: 403,
      body: { ok: false, error: { code: 'capability_forbidden' } },
    });
  });

  it('searches, updates, and reads Canvas nodes through the runtime protocol', async () => {
    await setCapabilityRuntimeEnabled(true);
    await writeCanvasFull('ws-runtime', {
      nodes: [{
        id: 'note-1',
        type: 'text',
        title: 'Draft',
        x: 0,
        y: 0,
        width: 240,
        height: 160,
        data: { content: 'runtime original' },
      }],
      edges: [],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: new Date().toISOString(),
    });
    await startRuntimeControlServer();
    const runtime = await readRuntimeFile();

    const searched = await postRuntime(runtime, '/capabilities/call', {
      workspaceId: 'ws-runtime',
      name: 'canvas.nodes.search',
      input: { query: 'original' },
    });
    expect(searched).toMatchObject({
      status: 200,
      body: { ok: true, value: { total: 1, matches: [{ id: 'note-1' }] } },
    });

    const updated = await postRuntime(runtime, '/capabilities/call', {
      workspaceId: 'ws-runtime',
      name: 'canvas.nodes.update',
      input: { nodeId: 'note-1', title: 'Runtime updated', content: 'runtime final' },
    });
    expect(updated).toEqual({
      status: 200,
      body: { ok: true, value: { nodeId: 'note-1' } },
    });

    const unsafePatch = await postRuntime(runtime, '/capabilities/call', {
      workspaceId: 'ws-runtime',
      name: 'canvas.nodes.update',
      input: { nodeId: 'note-1', data: { filePath: '/tmp/redirected.md' } },
    });
    expect(unsafePatch).toMatchObject({
      status: 409,
      body: { ok: false, error: { code: 'unsafe_input' } },
    });

    const read = await postRuntime(runtime, '/capabilities/call', {
      workspaceId: 'ws-runtime',
      name: 'canvas.nodes.read',
      input: { nodeId: 'note-1' },
    });
    expect(read).toMatchObject({
      status: 200,
      body: {
        ok: true,
        value: { id: 'note-1', title: 'Runtime updated', content: 'runtime final' },
      },
    });

    const { data } = await readCanvasFull('ws-runtime');
    expect(data?.nodes?.[0]).toMatchObject({
      title: 'Runtime updated',
      data: { content: 'runtime final' },
    });
  });
});
