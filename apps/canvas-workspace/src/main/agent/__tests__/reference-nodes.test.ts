import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

// Pin `os.homedir()` to a temp dir BEFORE the modules under test load it so
// every default-rooted helper (canvas-storage, context-builder) reads/writes
// under the per-test sandbox instead of the developer's real ~/.pulse-coder.
const { sandboxHome } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}canvas-ref-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

import {
  readNodeDetail,
  buildDetailedContext,
  buildWorkspaceSummary,
  formatSummaryForPrompt,
} from '../context-builder';
import { writeCanvasFull, type CanvasSaveData } from '../../canvas/storage';

const SOURCE_WS = 'ws-source';
const MAIN_WS = 'ws-main';
const SOURCE_CONTENT = 'From static software lego to AI-native software lego.';

async function writeManifest(): Promise<void> {
  const dir = join(sandboxHome, '.pulse-coder', 'canvas');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, '__workspaces__.json'),
    JSON.stringify({
      workspaces: [
        { id: SOURCE_WS, name: 'Source Canvas' },
        { id: MAIN_WS, name: 'Main Canvas' },
      ],
      activeId: MAIN_WS,
    }),
    'utf-8',
  );
}

async function setupSource(): Promise<void> {
  const canvas: CanvasSaveData = {
    nodes: [
      {
        id: 'src-text',
        type: 'text',
        title: 'Lego Plan',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        data: { content: SOURCE_CONTENT },
      },
    ],
    edges: [],
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: new Date().toISOString(),
  };
  await writeCanvasFull(SOURCE_WS, canvas);
}

async function setupMainWithReference(nodeId = 'src-text'): Promise<void> {
  const canvas: CanvasSaveData = {
    nodes: [
      {
        id: 'ref-1',
        type: 'reference',
        title: 'Ref: Lego Plan',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        ref: { kind: 'workspace-node', workspaceId: SOURCE_WS, nodeId },
        data: { titleSnapshot: 'Lego Plan', typeSnapshot: 'text', workspaceNameSnapshot: 'Source Canvas' },
      },
    ],
    edges: [],
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: new Date().toISOString(),
  };
  await writeCanvasFull(MAIN_WS, canvas);
}

beforeEach(async () => {
  await fs.mkdir(join(sandboxHome, '.pulse-coder', 'canvas'), { recursive: true });
  await writeManifest();
});

afterEach(async () => {
  await fs.rm(join(sandboxHome, '.pulse-coder'), { recursive: true, force: true });
});

describe('readNodeDetail — reference nodes', () => {
  it('follows the ref to a source node in another workspace and returns its content', async () => {
    await setupSource();
    await setupMainWithReference();

    const detail = await readNodeDetail(MAIN_WS, 'ref-1');
    expect(detail).not.toBeNull();
    // The real body comes through instead of an empty shell.
    expect(detail!.content).toBe(SOURCE_CONTENT);
    // The on-canvas reference node's own identity is preserved...
    expect(detail!.id).toBe('ref-1');
    expect(detail!.type).toBe('reference');
    // ...annotated with where the content was actually read from.
    expect(detail!.refType).toBe('text');
    expect(detail!.refNodeId).toBe('src-text');
    expect(detail!.refWorkspaceId).toBe(SOURCE_WS);
    expect(detail!.refWorkspaceName).toBe('Source Canvas');
  });

  it('degrades to a diagnostic (not an empty shell) when the source is gone', async () => {
    // Source workspace exists but the referenced node id does not.
    await setupSource();
    await setupMainWithReference('does-not-exist');

    const detail = await readNodeDetail(MAIN_WS, 'ref-1');
    expect(detail).not.toBeNull();
    expect(detail!.content).toContain('source content unavailable');
    // Falls back to the persisted snapshot so the agent can still explain it.
    expect(detail!.content).toContain('Lego Plan');
    expect(detail!.content).toContain('Source Canvas');
    // No false resolution metadata when nothing resolved.
    expect(detail!.refNodeId).toBe('does-not-exist');
  });
});

describe('buildDetailedContext — reference nodes', () => {
  it('resolves reference content in the full workspace context', async () => {
    await setupSource();
    await setupMainWithReference();

    const ctx = await buildDetailedContext(MAIN_WS);
    expect(ctx).not.toBeNull();
    const refNode = ctx!.nodes.find((n) => n.id === 'ref-1');
    expect(refNode).toBeDefined();
    expect(refNode!.content).toBe(SOURCE_CONTENT);
    expect(refNode!.refNodeId).toBe('src-text');
  });
});

describe('formatSummaryForPrompt — reference nodes', () => {
  it('lists reference nodes with their resolved target so the agent knows they resolve', async () => {
    await setupSource();
    await setupMainWithReference();

    const summary = await buildWorkspaceSummary(MAIN_WS);
    expect(summary).not.toBeNull();
    const prompt = formatSummaryForPrompt(summary!);

    expect(prompt).toContain('## Reference Nodes');
    // The reference id and its source pointer both surface in the prompt.
    expect(prompt).toContain('[ref-1]');
    expect(prompt).toContain('[src-text]');
    expect(prompt).toContain('Source Canvas');
  });
});
