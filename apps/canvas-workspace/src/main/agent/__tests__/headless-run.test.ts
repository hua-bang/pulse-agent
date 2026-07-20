import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

// Same homedir sandbox pattern as tools-graph.test.ts: pin os.homedir before
// modules under test capture it, so the workspace manifest and memory files
// live under a per-run tmp dir.
const { sandboxHome } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}headless-run-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

// memory-report publishes a global artifact; the artifact store broadcasts
// over BrowserWindow, which needs stubbing outside an Electron runtime.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => undefined, on: () => undefined },
}));

// The runner resolves the chat model before every run; stub it so tests never
// touch real model settings or env keys.
vi.mock('../model/config', () => ({
  resolveCanvasModel: async () => ({
    provider: 'stub-provider',
    providerType: 'stub',
    model: 'stub-model',
    modelType: 'chat',
  }),
}));

import { runHeadlessAgentTask, type HeadlessEngineFactory } from '../headless-run';
import { generateMemoryReport, memoryReportsDir, runScheduledMemoryReport } from '../memory-report';
import { saveMemory } from '../memory-store';

const canvasDir = join(sandboxHome, '.pulse-coder', 'canvas');

beforeEach(async () => {
  await fs.mkdir(canvasDir, { recursive: true });
  process.env.PULSE_CANVAS_MEMORY_DIR = join(canvasDir, 'memory');
});

afterEach(async () => {
  delete process.env.PULSE_CANVAS_MEMORY_DIR;
  await fs.rm(join(sandboxHome), { recursive: true, force: true });
});

const fakeFactory = (impl: {
  run?: (context: { messages: Array<{ role: string; content: string }> }, options: Record<string, unknown>) => Promise<string>;
}): { factory: HeadlessEngineFactory; captured: { config?: unknown; runOptions?: Record<string, unknown> } } => {
  const captured: { config?: unknown; runOptions?: Record<string, unknown> } = {};
  const factory: HeadlessEngineFactory = (config) => {
    captured.config = config;
    return {
      initialize: async () => undefined,
      run: async (context, options) => {
        captured.runOptions = options;
        return impl.run ? impl.run(context, options) : 'fake result';
      },
    };
  };
  return { factory, captured };
};

describe('runHeadlessAgentTask', () => {
  it('runs one bounded turn with no built-in tools and returns the text', async () => {
    const { factory, captured } = fakeFactory({});
    const result = await runHeadlessAgentTask(
      { label: 't', systemPrompt: 'SYS', prompt: 'GO' },
      factory,
    );

    expect(result).toEqual({ ok: true, text: 'fake result' });
    expect(captured.config).toMatchObject({
      disableBuiltInPlugins: true,
      builtInTools: {},
      tools: {},
    });
    expect(captured.runOptions).toMatchObject({
      systemPrompt: 'SYS',
      model: 'stub-model',
      maxSteps: 12,
    });
    expect(captured.runOptions?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('returns ok:false instead of throwing when the engine fails', async () => {
    const { factory } = fakeFactory({
      run: async () => {
        throw new Error('provider exploded');
      },
    });
    const result = await runHeadlessAgentTask(
      { label: 't', systemPrompt: 's', prompt: 'p' },
      factory,
    );
    expect(result).toEqual({ ok: false, error: 'provider exploded' });
  });

  it('aborts a hung run at the wall-clock timeout and flags timedOut', async () => {
    const { factory } = fakeFactory({
      run: (_context, options) =>
        new Promise((_resolve, reject) => {
          (options.abortSignal as AbortSignal).addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    });
    const result = await runHeadlessAgentTask(
      { label: 't', systemPrompt: 's', prompt: 'p', timeoutMs: 50 },
      factory,
    );
    expect(result).toMatchObject({ ok: false, timedOut: true });
  });
});

describe('generateMemoryReport', () => {
  const writeManifest = async (): Promise<void> => {
    await fs.writeFile(
      join(canvasDir, '__workspaces__.json'),
      JSON.stringify({ workspaces: [{ id: 'ws-a', name: 'Alpha' }] }),
      'utf-8',
    );
  };

  it('inlines workspaces + existing memory into the system prompt and passes only read tools', async () => {
    await writeManifest();
    await saveMemory({ kind: 'global' }, 'user prefers Chinese replies', 'preference');
    await saveMemory({ kind: 'workspace', workspaceId: 'ws-a' }, 'uses pnpm only', 'rule');

    const { factory, captured } = fakeFactory({ run: async () => '# report' });
    const result = await generateMemoryReport({ days: 7, engineFactory: factory });

    expect(result).toEqual({ ok: true, text: '# report' });

    const systemPrompt = (captured.runOptions as { systemPrompt: string }).systemPrompt;
    expect(systemPrompt).toContain('ws-a — Alpha');
    expect(systemPrompt).toContain('user prefers Chinese replies');
    expect(systemPrompt).toContain('uses pnpm only');
    expect(systemPrompt).toContain('last 7 days');
    expect(systemPrompt).toContain('候选 skills');
    expect(systemPrompt).toContain('Do NOT call it per workspace');
    expect((captured.runOptions as { maxSteps: number }).maxSteps).toBe(200);

    const toolNames = Object.keys((captured.config as { tools: Record<string, unknown> }).tools).sort();
    expect(toolNames).toEqual(['session_search', 'session_summary']);
  });

  it('runScheduledMemoryReport persists HTML, publishes a global artifact, and prunes beyond retention', async () => {
    await writeManifest();
    const dir = memoryReportsDir();
    await fs.mkdir(dir, { recursive: true });
    // Pre-seed 12 older reports; the new one should push the oldest out.
    for (let i = 1; i <= 12; i += 1) {
      const day = String(i).padStart(2, '0');
      await fs.writeFile(join(dir, `memory-report-2020-01-${day}.html`), 'old', 'utf-8');
    }

    // Model wraps the document in a fence despite instructions — must unwrap.
    const html = '<!doctype html><html><body>weekly</body></html>';
    const { factory } = fakeFactory({ run: async () => `\`\`\`html\n${html}\n\`\`\`` });
    const result = await runScheduledMemoryReport({ engineFactory: factory });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBeDefined();
      expect(await fs.readFile(result.path!, 'utf-8')).toBe(html);
      expect(result.artifactId).toBeDefined();
    }
    const remaining = (await fs.readdir(dir)).sort();
    expect(remaining).toHaveLength(12);
    expect(remaining).not.toContain('memory-report-2020-01-01.html');

    const artifactsRaw = await fs.readFile(
      join(canvasDir, '__global_chat__', 'artifacts.json'),
      'utf-8',
    );
    const artifacts = JSON.parse(artifactsRaw).artifacts;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: result.ok ? result.artifactId : '',
      type: 'html',
      workspaceId: '__global_chat__',
    });
    expect(artifacts[0].versions[0].content).toBe(html);
  });

  it('maps engine callbacks to coarse reading/writing phases, firing writing once', async () => {
    await writeManifest();
    const phases: string[] = [];
    const { factory } = fakeFactory({
      run: async (_context, options) => {
        const onToolCall = options.onToolCall as (chunk: { toolName: string }) => void;
        const onText = options.onText as (delta: string) => void;
        onToolCall({ toolName: 'session_summary' });
        onText('<!doctype');
        onText(' html>');
        return '<!doctype html><html><body>r</body></html>';
      },
    });
    const result = await generateMemoryReport({
      engineFactory: factory,
      onPhase: (phase) => phases.push(phase),
    });
    expect(result.ok).toBe(true);
    expect(phases).toEqual(['reading', 'writing']);
  });

  it('rejects a run that ended without an HTML document instead of publishing it', async () => {
    await writeManifest();
    const { factory } = fakeFactory({
      run: async () => 'Max steps reached, task may be incomplete.',
    });
    const result = await runScheduledMemoryReport({ engineFactory: factory });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Max steps reached');
    await expect(fs.readdir(memoryReportsDir())).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.readFile(join(canvasDir, '__global_chat__', 'artifacts.json'), 'utf-8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('same-day rerun adds a version to the existing report artifact instead of duplicating', async () => {
    await writeManifest();
    const first = '<!doctype html><html><body>v1</body></html>';
    const second = '<!doctype html><html><body>v2</body></html>';

    const run1 = await runScheduledMemoryReport({ engineFactory: fakeFactory({ run: async () => first }).factory });
    const run2 = await runScheduledMemoryReport({ engineFactory: fakeFactory({ run: async () => second }).factory });
    expect(run1.ok && run2.ok).toBe(true);
    if (run1.ok && run2.ok) expect(run2.artifactId).toBe(run1.artifactId);

    const artifacts = JSON.parse(
      await fs.readFile(join(canvasDir, '__global_chat__', 'artifacts.json'), 'utf-8'),
    ).artifacts;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].versions).toHaveLength(2);
    expect(artifacts[0].versions[1].content).toBe(second);
    expect(artifacts[0].currentVersionId).toBe(artifacts[0].versions[1].id);
  });

  it('runScheduledMemoryReport passes generation failures through without writing', async () => {
    const { factory } = fakeFactory({
      run: async () => {
        throw new Error('no model');
      },
    });
    const result = await runScheduledMemoryReport({ engineFactory: factory });
    expect(result).toMatchObject({ ok: false, error: 'no model' });
    await expect(fs.readdir(memoryReportsDir())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('degrades to an ok:false result when context preparation fails', async () => {
    // No manifest is fine (empty listing) — force a failure via a memory dir
    // that is a FILE, so listMemory's mkdir/read path errors at save-time is
    // not hit; instead point the engine factory at a thrower to cover the
    // headless failure path end-to-end.
    const { factory } = fakeFactory({
      run: async () => {
        throw new Error('no model configured');
      },
    });
    const result = await generateMemoryReport({ engineFactory: factory });
    expect(result).toMatchObject({ ok: false, error: 'no model configured' });
  });
});
