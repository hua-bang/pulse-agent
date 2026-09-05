import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnginePluginContext } from '../../plugin/EnginePlugin.js';
import type { Tool } from '../../shared/types.js';
const fixtureHome = vi.hoisted(() => ({ directory: '' }));
vi.mock('os', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => fixtureHome.directory,
}));

let builtInRoleSoulPlugin: typeof import('./index.js').builtInRoleSoulPlugin;

function createPluginContextHarness(): {
  context: EnginePluginContext;
  tools: Record<string, Tool<any, any>>;
} {
  const tools: Record<string, Tool<any, any>> = {};
  const services = new Map<string, any>();
  const configs = new Map<string, any>();
  const hooks = new Map<string, Array<(input: any) => Promise<any>>>();

  const context: EnginePluginContext = {
    registerTool: (name: string, tool: any) => {
      tools[name] = tool;
    },
    registerTools: (nextTools: Record<string, any>) => {
      Object.assign(tools, nextTools);
    },
    getTool: (name: string) => tools[name],
    getTools: () => ({ ...tools }),
    getEngineInstance: () => ({}) as any,
    registerHook: (hookName: any, handler: any) => {
      const current = hooks.get(hookName) ?? [];
      current.push(handler);
      hooks.set(hookName, current);
    },
    registerService: <T>(name: string, service: T) => {
      services.set(name, service);
    },
    getService: <T>(name: string) => services.get(name) as T | undefined,
    getConfig: <T>(key: string) => configs.get(key) as T | undefined,
    setConfig: <T>(key: string, value: T) => {
      configs.set(key, value);
    },
    events: new EventEmitter(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };

  return { context, tools };
}

describe('builtInRoleSoulPlugin runtime registration persistence', () => {
  let tempDir = '';
  let originalStateDir: string | undefined;
  let originalPersist: string | undefined;
  const createdSoulDirs = new Set<string>();

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'pulse-coder-soul-runtime-'));

    originalStateDir = process.env.PULSE_CODER_SOUL_STATE_DIR;
    originalPersist = process.env.PULSE_CODER_SOUL_PERSIST;

    process.env.PULSE_CODER_SOUL_STATE_DIR = path.join(tempDir, 'state');
    process.env.PULSE_CODER_SOUL_PERSIST = '1';
    // The registry base is captured at module import, independently of stateDir.
    // Re-import only after the test home exists; never touch the real user vault.
    fixtureHome.directory = tempDir;
    vi.resetModules();
    ({ builtInRoleSoulPlugin } = await import('./index.js'));
  });

  afterEach(async () => {
    if (originalStateDir === undefined) {
      delete process.env.PULSE_CODER_SOUL_STATE_DIR;
    } else {
      process.env.PULSE_CODER_SOUL_STATE_DIR = originalStateDir;
    }

    if (originalPersist === undefined) {
      delete process.env.PULSE_CODER_SOUL_PERSIST;
    } else {
      process.env.PULSE_CODER_SOUL_PERSIST = originalPersist;
    }

    for (const soulDir of createdSoulDirs) {
      await rm(soulDir, { recursive: true, force: true });
    }
    createdSoulDirs.clear();

    await rm(tempDir, { recursive: true, force: true });
  });

  it('persists registered souls to ~/.pulse-coder/souls/<id>/SOUL.md and reloads after re-initialization', async () => {
    const soulId = `__vitest_runtime_persisted_soul_${Date.now()}__`;
    const soulDir = path.join(tempDir, '.pulse-coder', 'souls', soulId);
    const soulFile = path.join(soulDir, 'SOUL.md');
    createdSoulDirs.add(soulDir);

    const firstHarness = createPluginContextHarness();
    await builtInRoleSoulPlugin.initialize(firstHarness.context);

    await firstHarness.tools.soul_register.execute({
      id: soulId,
      name: 'Runtime Persisted Soul',
      prompt: 'Stay grounded and evidence-based.',
    });

    const fileStat = await stat(soulFile);
    expect(fileStat.isFile()).toBe(true);

    const persistedContent = await readFile(soulFile, 'utf-8');
    expect(persistedContent).toContain(`id: "${soulId}"`);
    expect(persistedContent).toContain('Stay grounded and evidence-based.');

    const secondHarness = createPluginContextHarness();
    await builtInRoleSoulPlugin.initialize(secondHarness.context);

    const soulList = await secondHarness.tools.soul_list.execute({ format: 'full' }) as Array<Record<string, any>>;
    const persistedSoul = soulList.find((item) => item.id === soulId);

    expect(persistedSoul).toBeDefined();
    expect(String(persistedSoul?.location ?? '')).toContain('SOUL.md');
  });

  it('keeps registered soul definition after soul_clear removes active session state', async () => {
    const soulId = `__vitest_runtime_clear_keeps_registry_${Date.now()}__`;
    const sessionId = 'session-clear-keeps-registry';
    const soulDir = path.join(tempDir, '.pulse-coder', 'souls', soulId);
    const soulFile = path.join(soulDir, 'SOUL.md');
    createdSoulDirs.add(soulDir);

    const harness = createPluginContextHarness();
    await builtInRoleSoulPlugin.initialize(harness.context);

    await harness.tools.soul_register.execute({
      id: soulId,
      name: 'Clear Keeps Registry',
      prompt: 'Clear active state but keep registration.',
    });

    await harness.tools.soul_use.execute({ sessionId, soulId });
    const beforeClear = await harness.tools.soul_status.execute({ sessionId }) as { state?: { activeSoulIds?: string[] } };
    expect(beforeClear.state?.activeSoulIds).toContain(soulId);

    await harness.tools.soul_clear.execute({ sessionId });

    const afterClear = await harness.tools.soul_status.execute({ sessionId }) as { state?: { activeSoulIds?: string[] } };
    expect(afterClear.state?.activeSoulIds ?? []).toEqual([]);

    const soulList = await harness.tools.soul_list.execute({ format: 'summary' }) as Array<{ id: string }>;
    expect(soulList.some((item) => item.id === soulId)).toBe(true);

    const fileStat = await stat(soulFile);
    expect(fileStat.isFile()).toBe(true);
  });

  it('preserves source ordering and skips malformed soul files with async scanning', async () => {
    const soulId = `async-scan-order-${Date.now()}`;
    const pulseFile = path.join(tempDir, '.pulse-coder', 'souls', 'pulse', 'SOUL.md');
    const agentsFile = path.join(tempDir, '.agents', 'souls', 'agents', 'SOUL.md');
    const brokenFile = path.join(tempDir, '.pulse-coder', 'souls', 'broken', 'SOUL.md');
    await mkdir(path.dirname(pulseFile), { recursive: true });
    await mkdir(path.dirname(agentsFile), { recursive: true });
    await mkdir(path.dirname(brokenFile), { recursive: true });
    await writeFile(pulseFile, `---\nid: ${soulId}\nname: Pulse Source\n---\nfirst`, 'utf-8');
    await writeFile(agentsFile, `---\nid: ${soulId}\nname: Agents Source\n---\nsecond`, 'utf-8');
    await writeFile(brokenFile, '---\nid: broken\n---\n', 'utf-8');
    process.env.PULSE_CODER_SOUL_PERSIST = '0';
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    try {
      const harness = createPluginContextHarness();
      await builtInRoleSoulPlugin.initialize(harness.context);
      const souls = await harness.tools.soul_list.execute({ format: 'full' }) as Array<Record<string, any>>;
      const scanned = souls.find(soul => soul.id === soulId);
      expect(scanned).toMatchObject({ name: 'Agents Source', prompt: 'second' });
      expect(souls.some(soul => soul.id === 'broken')).toBe(false);
    } finally {
      cwd.mockRestore();
    }
  });
});
