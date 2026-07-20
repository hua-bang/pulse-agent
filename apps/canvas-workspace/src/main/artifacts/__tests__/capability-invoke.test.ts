import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

const { sandboxHome } = vi.hoisted(() => {
  const base = process.env.TMPDIR || '/tmp';
  return {
    sandboxHome: `${base}/artifact-cap-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => undefined, on: () => undefined },
}));

import { invokeArtifactCapability } from '../capability-ipc';
import { createArtifact } from '../store';
import { listMemory } from '../../agent/memory-store';

const canvasDir = join(sandboxHome, '.pulse-coder', 'canvas');

describe('invokeArtifactCapability', () => {
  beforeEach(async () => {
    await fs.mkdir(canvasDir, { recursive: true });
    process.env.PULSE_CANVAS_MEMORY_DIR = join(canvasDir, 'memory');
    await fs.writeFile(
      join(canvasDir, '__workspaces__.json'),
      JSON.stringify({ workspaces: [{ id: 'ws-a', name: 'Alpha' }] }),
      'utf-8',
    );
  });

  afterEach(async () => {
    delete process.env.PULSE_CANVAS_MEMORY_DIR;
    await fs.rm(sandboxHome, { recursive: true, force: true });
  });

  const makeArtifact = (capabilities?: string[]) =>
    createArtifact('__global_chat__', {
      type: 'html',
      title: 'report',
      content: '<!doctype html><html></html>',
      capabilities,
    });

  it('rejects unknown artifacts and undeclared capabilities', async () => {
    const undeclared = await makeArtifact(); // no capabilities
    expect(
      await invokeArtifactCapability({
        workspaceId: '__global_chat__',
        artifactId: 'art-missing',
        capability: 'memory.adopt',
        payload: { content: 'x' },
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('not found') });

    expect(
      await invokeArtifactCapability({
        workspaceId: '__global_chat__',
        artifactId: undeclared.id,
        capability: 'memory.adopt',
        payload: { content: 'x' },
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('not declared') });
  });

  it('memory.adopt writes to the right scope and validates workspace ids', async () => {
    const artifact = await makeArtifact(['memory.adopt', 'skill.save']);

    const globalResult = await invokeArtifactCapability({
      workspaceId: '__global_chat__',
      artifactId: artifact.id,
      capability: 'memory.adopt',
      payload: { content: 'prefers Chinese replies', kind: 'preference' },
    });
    expect(globalResult.ok).toBe(true);
    expect((await listMemory({ kind: 'global' })).map((e) => e.content)).toEqual([
      'prefers Chinese replies',
    ]);

    const wsResult = await invokeArtifactCapability({
      workspaceId: '__global_chat__',
      artifactId: artifact.id,
      capability: 'memory.adopt',
      payload: { content: 'uses fetch', kind: 'rule', workspaceId: 'ws-a' },
    });
    expect(wsResult.ok).toBe(true);
    expect((await listMemory({ kind: 'workspace', workspaceId: 'ws-a' })).map((e) => e.content)).toEqual([
      'uses fetch',
    ]);

    expect(
      await invokeArtifactCapability({
        workspaceId: '__global_chat__',
        artifactId: artifact.id,
        capability: 'memory.adopt',
        payload: { content: 'orphan', workspaceId: 'ws-nope' },
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('ws-nope') });
  });

  it('skill.save writes a SKILL.md via the canvas skills path', async () => {
    const artifact = await makeArtifact(['skill.save']);
    const result = await invokeArtifactCapability({
      workspaceId: '__global_chat__',
      artifactId: artifact.id,
      capability: 'skill.save',
      payload: {
        name: 'weekly-triage',
        description: 'When the user asks to triage the week, do X.',
        body: '# weekly-triage\n\n1. step one',
        scope: 'global',
      },
    });
    expect(result.ok).toBe(true);

    const skillFile = join(canvasDir, 'skills', 'weekly-triage', 'SKILL.md');
    const content = await fs.readFile(skillFile, 'utf-8');
    expect(content).toContain('weekly-triage');
    expect(content).toContain('step one');
  });

  it('caps payload sizes', async () => {
    const artifact = await makeArtifact(['memory.adopt']);
    expect(
      await invokeArtifactCapability({
        workspaceId: '__global_chat__',
        artifactId: artifact.id,
        capability: 'memory.adopt',
        payload: { content: 'x'.repeat(501) },
      }),
    ).toMatchObject({ ok: false });
  });
});
