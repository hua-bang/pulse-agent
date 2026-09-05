import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inferWorkingDirectoryFromText } from './working-directory';

const fakeHome = vi.hoisted(() => ({ value: '' }));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => fakeHome.value };
});

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('agent team working directory inference', () => {
  it('selects the longest existing absolute directory and trims punctuation', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'agent-team-cwd-'));
    const nested = join(parent, 'nested');
    await mkdir(nested);
    created.push(parent);

    expect(inferWorkingDirectoryFromText(`Use ${parent}, then work in ${nested}.`)).toBe(nested);
  });

  it('ignores missing paths', () => {
    expect(inferWorkingDirectoryFromText('Use /definitely/missing/pulse-canvas-path.')).toBeUndefined();
  });

  it('expands home-relative paths and trims CJK punctuation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agent-team-home-'));
    const nested = join(home, 'nested');
    await mkdir(nested);
    created.push(home);
    fakeHome.value = home;

    expect(inferWorkingDirectoryFromText('请使用 ~/nested。')).toBe(nested);
  });
});
