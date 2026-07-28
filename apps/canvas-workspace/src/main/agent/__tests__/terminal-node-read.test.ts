import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

// Pin `os.homedir()` to a temp dir BEFORE the modules under test load it so
// context-builder reads from the per-test sandbox, not the developer's real
// ~/.pulse-coder.
const { sandboxHome } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}canvas-term-read-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

// context-builder → webview/registry imports electron. Stub it so the live
// webview lookup degrades to "not registered" rather than crashing the suite.
vi.mock('electron', () => ({
  ipcMain: { handle: () => undefined, on: () => undefined },
  webContents: { getAllWebContents: () => [] },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { readNodeDetail, buildDetailedContext } from '../context-builder';
import { NODE_SCROLLBACK_READ_MAX_CHARS } from '../../terminal/scrollback-text';
import { writeCanvasFull, type CanvasSaveData } from '../../canvas/storage';

const WS = 'ws-terminal';
const ESC = String.fromCharCode(27);

/** A redrawn TUI frame: box glyphs plus right-edge padding out to 60 columns. */
const FRAME = [
  '╭──────────────────────────╮',
  ('│ Claude Code — Welcome back!' + ' '.repeat(30)).slice(0, 59) + '│',
  '╰──────────────────────────╯',
  '',
].join('\n');

/** ~50k chars of stored scrollback, i.e. the renderer's persisted cap. */
const STORED_TUI_SCROLLBACK = FRAME.repeat(Math.ceil(50_000 / FRAME.length)).slice(0, 50_000);

async function writeManifest(): Promise<void> {
  const dir = join(sandboxHome, '.pulse-coder', 'canvas');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, '__workspaces__.json'),
    JSON.stringify({ workspaces: [{ id: WS, name: 'Terminal Canvas' }], activeId: WS }),
    'utf-8',
  );
}

async function writeCanvas(nodes: CanvasSaveData['nodes']): Promise<void> {
  await writeCanvasFull(WS, {
    nodes,
    edges: [],
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: new Date().toISOString(),
  } as CanvasSaveData);
}

function node(id: string, type: 'terminal' | 'agent', data: Record<string, unknown>) {
  return { id, type, title: id, x: 0, y: 0, width: 400, height: 300, data };
}

describe('canvas_read_node scrollback normalization', () => {
  beforeEach(async () => {
    await fs.rm(sandboxHome, { recursive: true, force: true });
    await writeManifest();
  });

  afterEach(async () => {
    await fs.rm(sandboxHome, { recursive: true, force: true });
  });

  it('caps a 50k TUI buffer so a terminal node read stays inline', async () => {
    await writeCanvas([node('term-1', 'terminal', { scrollback: STORED_TUI_SCROLLBACK, cwd: '/tmp' })]);

    const detail = await readNodeDetail(WS, 'term-1');

    expect(detail?.scrollback).toBeDefined();
    const text = detail!.scrollback!;
    // The whole point: the read no longer carries the stored 50k, and stays
    // under the engine's 30k tool-offload threshold so it is not written to
    // disk and replaced by a stub the agent has to re-read.
    expect(STORED_TUI_SCROLLBACK.length).toBe(50_000);
    expect(text.length).toBeLessThan(30_000);
    expect(text.length).toBeLessThan(NODE_SCROLLBACK_READ_MAX_CHARS + 200);
    expect(text).toContain('Welcome back!');
    expect(text).toMatch(/^\[… [\d,]+ chars of earlier scrollback omitted …\]\n/);
    expect(detail!.cwd).toBe('/tmp');
  });

  it('applies the same normalization to agent nodes', async () => {
    await writeCanvas([node('agent-1', 'agent', { scrollback: STORED_TUI_SCROLLBACK, cwd: '/repo' })]);

    const detail = await readNodeDetail(WS, 'agent-1');

    expect(detail!.scrollback!.length).toBeLessThan(30_000);
    expect(detail!.scrollback).toMatch(/^\[… [\d,]+ chars of earlier scrollback omitted …\]\n/);
    expect(detail!.cwd).toBe('/repo');
  });

  it('strips control bytes and padding from scrollback written outside the app', async () => {
    const raw = `${ESC}[32m$ pnpm test${ESC}[0m   \n\n\n\nAll tests passed   `;
    await writeCanvas([node('term-2', 'terminal', { scrollback: raw, cwd: '' })]);

    const detail = await readNodeDetail(WS, 'term-2');

    expect(detail!.scrollback).toBe('$ pnpm test\n\nAll tests passed');
  });

  it('leaves a short session verbatim and un-annotated', async () => {
    await writeCanvas([node('term-3', 'terminal', { scrollback: '$ ls\nREADME.md', cwd: '' })]);

    const detail = await readNodeDetail(WS, 'term-3');

    expect(detail!.scrollback).toBe('$ ls\nREADME.md');
  });

  it('returns an empty string when a node has never produced output', async () => {
    await writeCanvas([node('term-4', 'terminal', { cwd: '' })]);

    expect((await readNodeDetail(WS, 'term-4'))!.scrollback).toBe('');
  });

  it('normalizes every node in the full canvas_read_context path too', async () => {
    // buildDetailedContext shares populateNodeDetail with readNodeDetail; a
    // canvas with several terminals is where the un-capped read hurt most.
    await writeCanvas([
      node('term-a', 'terminal', { scrollback: STORED_TUI_SCROLLBACK, cwd: '/a' }),
      node('term-b', 'agent', { scrollback: STORED_TUI_SCROLLBACK, cwd: '/b' }),
      node('term-c', 'terminal', { scrollback: STORED_TUI_SCROLLBACK, cwd: '/c' }),
    ]);

    const ctx = await buildDetailedContext(WS);

    const total = ctx!.nodes.reduce((sum, n) => sum + (n.scrollback?.length ?? 0), 0);
    expect(total).toBeLessThan(150_000 / 3); // was 3 × 50k
    for (const n of ctx!.nodes) {
      expect(n.scrollback!.length).toBeLessThan(NODE_SCROLLBACK_READ_MAX_CHARS + 200);
    }
  });
});
