import { describe, expect, it, vi } from 'vitest';

// store.ts pulls in Electron at module scope; the merge helper under test is
// pure, so stub the runtime surface.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: { showMessageBox: vi.fn() },
}));

import { preserveMainOwnedQueueFields } from '../canvas/store';

type MergeNode = Parameters<typeof preserveMainOwnedQueueFields>[0];

const teamAgentNode = (
  data: Record<string, unknown>,
  updatedAt: number,
): MergeNode => ({
  id: 'node-1',
  type: 'agent',
  title: 'QA Codex',
  x: 0,
  y: 0,
  width: 480,
  height: 260,
  data: { agentTeamId: 'team-1', agentTeamAgentId: 'agent-1', ...data },
  updatedAt,
});

describe('preserveMainOwnedQueueFields', () => {
  it('grafts a newer queued prompt from disk onto a stale renderer save', () => {
    // Main queued a prompt (rev 2) after the renderer's snapshot (rev 1);
    // the renderer node wins on updatedAt because its scrollback tick bumped
    // it. The queue fields must survive the merge anyway.
    const memory = teamAgentNode(
      { status: 'done', inlinePrompt: '', promptFile: '', queueRev: 1, scrollback: 'fresh output' },
      2_000,
    );
    const disk = teamAgentNode(
      { status: 'running', viewMode: 'running', inlinePrompt: 'queued lead notification', promptFile: '', lastInitPrompt: 'queued lead notification', queueRev: 2 },
      1_000,
    );

    const merged = preserveMainOwnedQueueFields(memory, disk);
    expect(merged.data).toMatchObject({
      inlinePrompt: 'queued lead notification',
      lastInitPrompt: 'queued lead notification',
      status: 'running',
      viewMode: 'running',
      queueRev: 2,
      // Renderer-owned fields from the winning memory node are kept.
      scrollback: 'fresh output',
    });
  });

  it('lets a renderer that consumed the queue clear it (same queueRev)', () => {
    // The renderer launched the agent with the queued prompt: its snapshot
    // carries the same queueRev, so the legitimate clear passes through.
    const memory = teamAgentNode(
      { status: 'running', inlinePrompt: '', promptFile: '', queueRev: 2 },
      2_000,
    );
    const disk = teamAgentNode(
      { status: 'running', inlinePrompt: 'already consumed', promptFile: '', queueRev: 2 },
      1_000,
    );

    const merged = preserveMainOwnedQueueFields(memory, disk);
    expect(merged).toBe(memory);
  });

  it('ignores non-team agent nodes and non-agent nodes', () => {
    const plainAgentMemory: MergeNode = {
      ...teamAgentNode({ inlinePrompt: '' }, 2_000),
      data: { inlinePrompt: '', queueRev: 0 },
    };
    const plainAgentDisk: MergeNode = {
      ...teamAgentNode({ inlinePrompt: 'x' }, 1_000),
      data: { inlinePrompt: 'x', queueRev: 5 },
    };
    expect(preserveMainOwnedQueueFields(plainAgentMemory, plainAgentDisk)).toBe(plainAgentMemory);

    const fileMemory = { ...plainAgentMemory, type: 'file' as const };
    const fileDisk = { ...plainAgentDisk, type: 'file' as const };
    expect(preserveMainOwnedQueueFields(fileMemory, fileDisk)).toBe(fileMemory);
  });
});
