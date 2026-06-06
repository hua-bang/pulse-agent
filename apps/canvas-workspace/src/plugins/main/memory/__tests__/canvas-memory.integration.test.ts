import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * End-to-end against a real FileMemoryPluginService on a temp dir. Self-skips
 * when the plugin can't load in this environment (e.g. better-sqlite3 not built
 * / not yet bundled), so it adds coverage wherever native deps are available
 * without breaking the suite where they are not.
 */
// Non-literal specifier + @vite-ignore so the bundler does NOT resolve the
// package at transform time — it may be unbuilt (no dist) in some
// environments, in which case the runtime import throws and we skip cleanly.
const MEMORY_PKG = 'pulse-coder-memory-plugin';
let pluginModule: typeof import('pulse-coder-memory-plugin') | undefined;
try {
  pluginModule = await import(/* @vite-ignore */ MEMORY_PKG);
} catch {
  pluginModule = undefined;
}

describe.skipIf(!pluginModule)('canvas memory integration (workspace scope)', () => {
  const scope = { kind: 'workspace', workspaceId: 'w1' } as const;
  let tmp: string;
  let canvasMemory: typeof import('../canvas-memory');
  let serviceModule: typeof import('../canvas-memory-service');

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'canvas-mem-'));
    const service = new pluginModule!.FileMemoryPluginService({ baseDir: tmp, semanticRecallEnabled: false });
    await service.initialize();
    serviceModule = await import('../canvas-memory-service');
    serviceModule.__setCanvasMemoryServiceForTest(service);
    canvasMemory = await import('../canvas-memory');
  });

  afterAll(() => {
    serviceModule?.__setCanvasMemoryServiceForTest(null);
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('isolates buckets: a workspace sediment never leaks into global recall', async () => {
    await canvasMemory.sedimentTurn({
      scope,
      sessionId: 's1',
      userText: 'Remember we use pnpm workspaces for this project',
      assistantText: 'Understood.',
    });
    const global = await canvasMemory.recallMemory({ scope, query: 'pnpm', granularity: 'global' });
    expect(global).toEqual([]);
  });

  it('returns an array for every granularity (wiring smoke test)', async () => {
    for (const granularity of ['session', 'workspace', 'global', 'all'] as const) {
      const res = await canvasMemory.recallMemory({ scope, sessionId: 's1', query: 'pnpm', granularity });
      expect(Array.isArray(res)).toBe(true);
    }
  });
});
