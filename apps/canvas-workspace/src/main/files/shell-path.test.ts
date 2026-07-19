import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { configurePulseCanvasShellPath, inspectPulseCanvasShellPath } from './shell-path';

describe('Pulse Canvas shell PATH configuration', () => {
  it('adds the managed bin directory to zsh exactly once', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pulse-shell-path-'));
    const options = { home, shell: '/bin/zsh', platform: 'darwin' as const };

    const before = await inspectPulseCanvasShellPath(options);
    expect(before).toMatchObject({ supported: true, configured: false });
    expect(before.profilePath).toBe(join(home, '.zshrc'));

    const first = await configurePulseCanvasShellPath(options);
    const second = await configurePulseCanvasShellPath(options);

    expect(first).toMatchObject({ ok: true, configured: true, changed: true });
    expect(second).toMatchObject({ ok: true, configured: true, changed: false });
    const profile = await readFile(join(home, '.zshrc'), 'utf8');
    expect(profile.match(/\.pulse-coder\/bin/g)).toHaveLength(1);
    expect(profile).toContain('export PATH="$HOME/.pulse-coder/bin:$PATH"');
  });

  it('preserves an existing profile and uses the macOS bash login profile', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pulse-shell-path-'));
    const profilePath = join(home, '.bash_profile');
    await writeFile(profilePath, 'export KEEP=1\n');

    await configurePulseCanvasShellPath({ home, shell: '/bin/bash', platform: 'darwin' });

    const profile = await readFile(profilePath, 'utf8');
    expect(profile).toContain('export KEEP=1\n');
    expect(profile).toContain('export PATH="$HOME/.pulse-coder/bin:$PATH"');
  });

  it('uses fish_add_path for fish and reports unsupported shells without writing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pulse-shell-path-'));
    const fish = await configurePulseCanvasShellPath({ home, shell: '/opt/homebrew/bin/fish', platform: 'darwin' });
    expect(fish.profilePath).toBe(join(home, '.config', 'fish', 'config.fish'));
    expect(await readFile(fish.profilePath!, 'utf8')).toContain('fish_add_path "$HOME/.pulse-coder/bin"');

    const unsupported = await configurePulseCanvasShellPath({
      home,
      shell: '/bin/tcsh',
      platform: 'darwin',
    });
    expect(unsupported).toMatchObject({ ok: false, supported: false, configured: false, changed: false });
  });

  it('defaults macOS to zsh and does not treat a commented path as configured', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pulse-shell-path-'));
    await writeFile(join(home, '.zshrc'), '# old ~/.pulse-coder/bin setup was removed\n');

    const before = await inspectPulseCanvasShellPath({ home, platform: 'darwin' });
    expect(before).toMatchObject({ shell: 'zsh', configured: false });

    await configurePulseCanvasShellPath({ home, platform: 'darwin' });
    expect(await readFile(join(home, '.zshrc'), 'utf8')).toContain(
      'export PATH="$HOME/.pulse-coder/bin:$PATH"',
    );
  });

  it('does not mistake an unrelated path mention for PATH configuration', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pulse-shell-path-'));
    await writeFile(join(home, '.zshrc'), 'echo "$HOME/.pulse-coder/bin"\n');

    const result = await inspectPulseCanvasShellPath({ home, shell: '/bin/zsh', platform: 'darwin' });

    expect(result).toMatchObject({ ok: true, configured: false });
  });

  it('reports an unreadable profile without rejecting status inspection', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pulse-shell-path-'));
    const profilePath = join(home, '.zshrc');
    await mkdir(profilePath);

    await expect(
      inspectPulseCanvasShellPath({ home, shell: '/bin/zsh', platform: 'darwin' }),
    ).resolves.toMatchObject({ ok: false, supported: true, configured: false, profilePath });
  });
});
