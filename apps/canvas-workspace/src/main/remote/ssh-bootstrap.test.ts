import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getRemoteWorkspaceConfig } from './config';
import {
  bootstrapAndSaveVpsWorkspace,
  bootstrapRemoteVpsDaemon,
  parseSshConfigHosts,
  type SshRunner,
} from './ssh-bootstrap';

function assertValidPosixShell(script: string): void {
  if (process.platform === 'win32') return;
  execFileSync('/bin/sh', ['-n'], { input: script, stdio: ['pipe', 'pipe', 'pipe'] });
}

describe('ssh-bootstrap', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    delete process.env.PULSE_CANVAS_REMOTE_CONFIG;
    while (cleanups.length) {
      await cleanups.pop()?.();
    }
  });

  it('parses concrete Host aliases from ~/.ssh/config and ignores wildcards', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulse-ssh-cfg-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const cfgPath = join(dir, 'config');
    await writeFile(
      cfgPath,
      [
        '# comment',
        'Host *',
        '  ServerAliveInterval 30',
        'Host my-cn-vps dev-box',
        '  HostName 1.2.3.4',
        'Host staging-* !staging-old',
        '  User root',
      ].join('\n'),
      'utf8',
    );
    expect(parseSshConfigHosts(cfgPath)).toEqual(['my-cn-vps', 'dev-box']);
  });

  it('uploads bundle, installs deps, generates token, and starts daemon with valid POSIX shell scripts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulse-boot-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const bundlePath = join(dir, 'index.cjs');
    await writeFile(bundlePath, 'console.log("vps-daemon");\n', 'utf8');
    process.env.PULSE_CANVAS_REMOTE_CONFIG = join(dir, 'remote-workspaces.json');

    const scripts: string[] = [];
    let uploadedBytes = 0;

    const fakeRunner: SshRunner = async ({ remoteCommand, stdin }) => {
      if (remoteCommand === 'sh -s' && typeof stdin === 'string') {
        assertValidPosixShell(stdin);
        scripts.push(stdin);
        if (stdin.includes('NODE_V=')) {
          return { code: 0, stdout: 'v22.14.0\n\nmissing\ndown\n', stderr: '' };
        }
        if (stdin.includes('npm install')) {
          return { code: 0, stdout: 'added 2 packages', stderr: '' };
        }
        if (stdin.includes('TOKEN_FILE=')) {
          return { code: 0, stdout: 'generated-token-abc123\n', stderr: '' };
        }
        if (stdin.includes('nohup node index.cjs')) {
          return { code: 0, stdout: '', stderr: '' };
        }
      }
      if (remoteCommand.includes('index.cjs.tmp')) {
        assertValidPosixShell(remoteCommand);
        uploadedBytes = Buffer.isBuffer(stdin) ? stdin.length : 0;
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: `unexpected command: ${remoteCommand}` };
    };

    const { config, bootstrap } = await bootstrapAndSaveVpsWorkspace('cn-vps-ws', {
      sshHost: 'dev@my-cn-vps',
      remotePort: 4770,
      cwd: '/home/dev/app',
      daemonBundlePath: bundlePath,
      sshRunner: fakeRunner,
    });

    expect(bootstrap.uploaded).toBe(true);
    expect(bootstrap.installedDeps).toBe(true);
    expect(bootstrap.restarted).toBe(true);
    expect(bootstrap.token).toBe('generated-token-abc123');
    expect(uploadedBytes).toBeGreaterThan(0);
    expect(scripts).toHaveLength(4);

    expect(config.sshHost).toBe('dev@my-cn-vps');
    expect(getRemoteWorkspaceConfig('cn-vps-ws')?.token).toBe('generated-token-abc123');
  });

  it('skips upload, npm install, and restart when remote daemon is already up to date', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulse-boot-idemp-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const bundlePath = join(dir, 'index.cjs');
    await writeFile(bundlePath, 'console.log("same");\n', 'utf8');

    const expectedHash = createHash('sha256')
      .update(Buffer.from('console.log("same");\n'))
      .digest('hex')
      .slice(0, 16);

    const calls: string[] = [];
    const fakeRunner: SshRunner = async ({ remoteCommand, stdin }) => {
      if (remoteCommand === 'sh -s' && typeof stdin === 'string') {
        assertValidPosixShell(stdin);
        calls.push(stdin);
        if (stdin.includes('NODE_V=')) {
          return { code: 0, stdout: `v22.14.0\n${expectedHash}\nok\nup\n`, stderr: '' };
        }
        if (stdin.includes('TOKEN_FILE=')) {
          return { code: 0, stdout: 'existing-token-xyz\n', stderr: '' };
        }
      }
      return { code: 1, stdout: '', stderr: `should not run: ${remoteCommand}` };
    };

    const res = await bootstrapRemoteVpsDaemon({
      sshHost: 'dev@my-cn-vps',
      daemonBundlePath: bundlePath,
      sshRunner: fakeRunner,
    });

    expect(res.uploaded).toBe(false);
    expect(res.installedDeps).toBe(false);
    expect(res.restarted).toBe(false);
    expect(res.token).toBe('existing-token-xyz');
    expect(calls).toHaveLength(2);
  });

  it('syncs pulse-canvas CLI and skills to remote VPS with valid POSIX shell scripts', async () => {
    const { syncRemoteCanvasTooling } = await import('./ssh-tooling');
    const dir = await mkdtemp(join(tmpdir(), 'pulse-tooling-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const cliPath = join(dir, 'index.cjs');
    const skillPath = join(dir, 'SKILL.md');
    await writeFile(cliPath, 'console.log("canvas-cli");\n', 'utf8');
    await writeFile(skillPath, '---\nname: canvas\n---\nUse pulse-canvas.', 'utf8');

    const scripts: string[] = [];
    let uploadedCli = false;
    const fakeRunner: SshRunner = async ({ remoteCommand, stdin }) => {
      if (remoteCommand === 'sh -s' && typeof stdin === 'string') {
        assertValidPosixShell(stdin);
        scripts.push(stdin);
        if (stdin.includes('canvas-cli.sha') && stdin.includes('BIN=')) {
          return { code: 0, stdout: '\nmissing\n', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      }
      if (remoteCommand.includes('canvas-cli/index.cjs.tmp')) {
        assertValidPosixShell(remoteCommand);
        uploadedCli = Buffer.isBuffer(stdin) && stdin.length > 0;
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: `unexpected: ${remoteCommand}` };
    };

    const synced = await syncRemoteCanvasTooling({
      sshHost: 'dev@my-cn-vps',
      sshPort: 22,
      remoteDir: '$HOME/.pulse-vps-daemon',
      dataDir: '$HOME/.pulse-coder/canvas',
      run: fakeRunner,
      cliBundlePath: cliPath,
      skillDocPath: skillPath,
    });

    expect(synced).toBe(true);
    expect(uploadedCli).toBe(true);
    expect(scripts).toHaveLength(2);
    expect(scripts[1]).toContain('PULSE_CANVAS_DATA_DIR');
    expect(scripts[1]).toContain('.codex/skills');
  });
});
