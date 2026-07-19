import { promises as fs } from 'fs';
import { basename, dirname, join } from 'path';

import type { ShellPathResult } from '../../shared/settings-config';

const START_MARKER = '# >>> Pulse Canvas CLI >>>';
const END_MARKER = '# <<< Pulse Canvas CLI <<<';

interface ShellPathOptions {
  home: string;
  shell?: string;
  platform: NodeJS.Platform;
}

interface ShellProfile {
  shell: string;
  profilePath: string;
  line: string;
}

export async function inspectPulseCanvasShellPath(
  options: ShellPathOptions,
): Promise<ShellPathResult> {
  const profile = resolveShellProfile(options);
  if (!profile) return unsupportedResult(options);
  try {
    const content = await readProfile(profile.profilePath);
    return {
      ok: true,
      supported: true,
      configured: hasManagedBin(content, profile.shell),
      changed: false,
      shell: profile.shell,
      profilePath: profile.profilePath,
      command: profile.line,
    };
  } catch (error) {
    return failureResult(profile, error);
  }
}

export async function configurePulseCanvasShellPath(
  options: ShellPathOptions,
): Promise<ShellPathResult> {
  const profile = resolveShellProfile(options);
  if (!profile) return unsupportedResult(options);

  try {
    const content = await readProfile(profile.profilePath);
    if (hasManagedBin(content, profile.shell)) {
      return {
        ok: true,
        supported: true,
        configured: true,
        changed: false,
        shell: profile.shell,
        profilePath: profile.profilePath,
        command: profile.line,
      };
    }
    await fs.mkdir(dirname(profile.profilePath), { recursive: true });
    const prefix = content.length === 0 || content.endsWith('\n') ? '' : '\n';
    await fs.appendFile(
      profile.profilePath,
      `${prefix}${START_MARKER}\n${profile.line}\n${END_MARKER}\n`,
      'utf8',
    );
    return {
      ok: true,
      supported: true,
      configured: true,
      changed: true,
      shell: profile.shell,
      profilePath: profile.profilePath,
      command: profile.line,
    };
  } catch (error) {
    return failureResult(profile, error);
  }
}

function resolveShellProfile(options: ShellPathOptions): ShellProfile | null {
  if (options.platform === 'win32') return null;
  const fallback = options.platform === 'darwin' ? 'zsh' : 'bash';
  const shell = basename(options.shell?.trim() || fallback);
  if (shell === 'zsh') {
    return shellProfile(shell, join(options.home, '.zshrc'));
  }
  if (shell === 'bash') {
    return shellProfile(
      shell,
      join(options.home, options.platform === 'darwin' ? '.bash_profile' : '.bashrc'),
    );
  }
  if (shell === 'fish') {
    return {
      shell,
      profilePath: join(options.home, '.config', 'fish', 'config.fish'),
      line: 'fish_add_path "$HOME/.pulse-coder/bin"',
    };
  }
  return null;
}

function shellProfile(shell: string, profilePath: string): ShellProfile {
  return {
    shell,
    profilePath,
    line: 'export PATH="$HOME/.pulse-coder/bin:$PATH"',
  };
}

function hasManagedBin(content: string, shell: string): boolean {
  return content.split('\n').some((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return false;
    if (shell === 'fish') {
      return /^fish_add_path\s+/.test(trimmed)
        && /(?:\$HOME|~)\/\.pulse-coder\/bin(?:["']|\s|$)/.test(trimmed);
    }
    return /^export\s+PATH=/.test(trimmed)
      && /(?:\$HOME|~)\/\.pulse-coder\/bin(?:["':]|$)/.test(trimmed);
  });
}

function failureResult(profile: ShellProfile, error: unknown): ShellPathResult {
  return {
    ok: false,
    supported: true,
    configured: false,
    changed: false,
    shell: profile.shell,
    profilePath: profile.profilePath,
    command: profile.line,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function readProfile(profilePath: string): Promise<string> {
  try {
    return await fs.readFile(profilePath, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

function unsupportedResult(options: ShellPathOptions): ShellPathResult {
  return {
    ok: false,
    supported: false,
    configured: false,
    changed: false,
    shell: basename(options.shell?.trim() || '') || null,
    profilePath: null,
    command: 'export PATH="$HOME/.pulse-coder/bin:$PATH"',
    error: 'Automatic PATH setup supports zsh, bash, and fish.',
  };
}
