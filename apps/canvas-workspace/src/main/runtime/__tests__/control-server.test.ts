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
vi.mock('electron', () => ({ app: { once: vi.fn() } }));

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

describe('runtime-control server lifecycle', () => {
  beforeEach(async () => {
    await fs.rm(__test.RUNTIME_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Always release the loopback port and clear module state between tests.
    await stopRuntimeControlServer();
    await fs.rm(__test.RUNTIME_DIR, { recursive: true, force: true });
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
});
