import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { delimiter, join } from 'path';
import { homedir } from 'os';

/**
 * A GUI-launched Electron app inherits a stripped PATH, and the engine's
 * `bash` tool spawns with no `env` — so whatever `process.env.PATH` holds is
 * exactly what the agent can resolve. These guard the repair that makes
 * `lark-cli` findable from chat instead of only from a real terminal.
 */
const h = vi.hoisted(() => ({
  execFileArgs: [] as unknown[],
  stdout: '',
  error: null as Error | null,
}));

vi.mock('child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    options: unknown,
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    h.execFileArgs.push({ file, args, options });
    callback(h.error, h.stdout);
  },
}));

import {
  applyLoginShellPath,
  augmentProcessPath,
  mergePath,
  resolveLoginShellPath,
  uniquePath,
} from '../shell-path';

const originalPath = process.env.PATH;
const originalShell = process.env.SHELL;

beforeEach(() => {
  h.execFileArgs.length = 0;
  h.stdout = '';
  h.error = null;
});

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = originalShell;
  vi.restoreAllMocks();
});

describe('mergePath', () => {
  it('keeps the existing PATH ahead of the additions and drops duplicates', () => {
    expect(mergePath('/usr/bin:/bin', ['/opt/homebrew/bin', '/usr/bin']).split(delimiter))
      .toEqual(['/usr/bin', '/bin', '/opt/homebrew/bin']);
  });

  it('handles an absent PATH', () => {
    expect(mergePath(undefined, ['/opt/homebrew/bin'])).toBe('/opt/homebrew/bin');
  });

  it('drops empty segments', () => {
    expect(uniquePath(['', '/usr/bin', '', '/usr/bin'])).toEqual(['/usr/bin']);
  });
});

describe('augmentProcessPath', () => {
  it('adds the per-user bin dirs a GUI launch is missing', () => {
    process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
    augmentProcessPath();

    const parts = (process.env.PATH ?? '').split(delimiter);
    expect(parts.slice(0, 4)).toEqual(['/usr/bin', '/bin', '/usr/sbin', '/sbin']);
    expect(parts).toContain('/opt/homebrew/bin');
    // The app installs its own CLI wrapper here, so it must resolve even when
    // the user never configured a shell PATH.
    expect(parts).toContain(join(homedir(), '.pulse-coder', 'bin'));
  });

  it('is idempotent', () => {
    process.env.PATH = '/usr/bin';
    augmentProcessPath();
    const once = process.env.PATH;
    augmentProcessPath();
    expect(process.env.PATH).toBe(once);
  });
});

describe('login shell PATH', () => {
  it('reads the marker line and ignores surrounding rc-file chatter', async () => {
    process.env.SHELL = '/bin/zsh';
    h.stdout = 'nvm loaded\n__PULSE_PATH__:/custom/bin:/usr/bin\nsome trailing noise\n';

    await expect(resolveLoginShellPath()).resolves.toBe('/custom/bin:/usr/bin');
    expect(h.execFileArgs[0]).toMatchObject({ file: '/bin/zsh', args: ['-ilc', expect.any(String)] });
  });

  it('merges the shell PATH without losing what the process already had', async () => {
    process.env.SHELL = '/bin/zsh';
    process.env.PATH = '/usr/bin';
    h.stdout = '__PULSE_PATH__:/custom/bin:/usr/bin\n';

    await expect(applyLoginShellPath()).resolves.toBe(true);
    expect((process.env.PATH ?? '').split(delimiter)).toEqual(['/usr/bin', '/custom/bin']);
  });

  it('leaves PATH untouched when the shell fails, times out, or prints nothing', async () => {
    process.env.SHELL = '/bin/zsh';
    process.env.PATH = '/usr/bin';

    h.error = new Error('timed out');
    await expect(applyLoginShellPath()).resolves.toBe(false);
    expect(process.env.PATH).toBe('/usr/bin');

    h.error = null;
    h.stdout = 'rc noise only\n';
    await expect(applyLoginShellPath()).resolves.toBe(false);
    expect(process.env.PATH).toBe('/usr/bin');
  });

  it('does not spawn anything when SHELL is unset', async () => {
    delete process.env.SHELL;
    await expect(resolveLoginShellPath()).resolves.toBeNull();
    expect(h.execFileArgs).toHaveLength(0);
  });
});
