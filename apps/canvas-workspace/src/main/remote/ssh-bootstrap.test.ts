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

  it('uploads bundle, installs deps, generates token, and starts daemon on fresh VPS', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulse-boot-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const bundlePath = join(dir, 'index.cjs');
    await writeFile(bundlePath, 'console.log("vps-daemon");\n', 'utf8');
    process.env.PULSE_CANVAS_REMOTE_CONFIG = join(dir, 'remote-workspaces.json');

    const commands: string[] = [];
    let uploadedBytes = 0;

    const fakeRunner: SshRunner = async ({ remoteCommand, stdin }) => {
      commands.push(remoteCommand);
      if (remoteCommand.includes('NODE_V=')) {
        return { code: 0, stdout: 'v22.14.0\n\nmissing\ndown\n', stderr: '' };
      }
      if (remoteCommand.includes('index.cjs.tmp')) {
        uploadedBytes = Buffer.isBuffer(stdin) ? stdin.length : 0;
        return { code: 0, stdout: '', stderr: '' };
      }
      if (remoteCommand.includes('npm install')) {
        return { code: 0, stdout: 'added 2 packages', stderr: '' };
      }
      if (remoteCommand.includes('TOKEN_FILE=')) {
        return { code: 0, stdout: 'generated-token-abc123\n', stderr: '' };
      }
      if (remoteCommand.includes('nohup node index.cjs')) {
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
    expect(commands).toHaveLength(5);

    expect(config.sshHost).toBe('dev@my-cn-vps');
    expect(getRemoteWorkspaceConfig('cn-vps-ws')?.token).toBe('generated-token-abc123');
  });

  it('skips upload, npm install, and restart when remote daemon is already up to date', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulse-boot-idemp-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const bundlePath = join(dir, 'index.cjs');
    await writeFile(bundlePath, 'console.log("same");\n', 'utf8');

    const { createHash } = await import('node:crypto');
    const expectedHash = createHash('sha256')
      .update(Buffer.from('console.log("same");\n'))
      .digest('hex')
      .slice(0, 16);

    const commands: string[] = [];
    const fakeRunner: SshRunner = async ({ remoteCommand }) => {
      commands.push(remoteCommand);
      if (remoteCommand.includes('NODE_V=')) {
        return { code: 0, stdout: `v22.14.0\n${expectedHash}\nok\nup\n`, stderr: '' };
      }
      if (remoteCommand.includes('TOKEN_FILE=')) {
        return { code: 0, stdout: 'existing-token-xyz\n', stderr: '' };
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
    expect(commands).toHaveLength(2);
  });
});
