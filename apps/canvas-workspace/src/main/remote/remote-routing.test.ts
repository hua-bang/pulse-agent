import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchRemoteWorkspaceFile, saveRemoteWorkspaceConfig } from './config';
import { resolveRemoteSpawnCwd } from './runtime-client';

describe('remote terminal cwd', () => {
  const isLocal = (dir: string) => dir.startsWith('/Users/');

  it('uses the configured VPS folder instead of the desktop root folder', () => {
    expect(resolveRemoteSpawnCwd('/Users/me/project', '/srv/app', isLocal)).toBe('/srv/app');
  });

  it('keeps a cwd restored from the remote session', () => {
    expect(resolveRemoteSpawnCwd('/home/ubuntu/repo', '/srv/app', isLocal)).toBe('/home/ubuntu/repo');
    expect(resolveRemoteSpawnCwd('~/repo', '/srv/app', isLocal)).toBe('~/repo');
  });

  it('returns undefined when nothing is configured and the cwd is local', () => {
    expect(resolveRemoteSpawnCwd('/Users/me/project', undefined, isLocal)).toBeUndefined();
    expect(resolveRemoteSpawnCwd(undefined, '  ', isLocal)).toBeUndefined();
  });
});

describe('matchRemoteWorkspaceFile', () => {
  const storeDir = mkdtempSync(join(tmpdir(), 'remote-routing-'));
  saveRemoteWorkspaceConfig('default', {
    kind: 'vps',
    endpoint: 'http://127.0.0.1:1',
    token: 't',
    storage: 'vps',
  }, storeDir);
  saveRemoteWorkspaceConfig('runtime-only', {
    kind: 'vps',
    endpoint: 'http://127.0.0.1:1',
    token: 't',
    storage: 'local',
    runtime: 'vps',
  }, storeDir);

  it('matches files inside a canvas data folder and pulse-remote URIs', () => {
    expect(matchRemoteWorkspaceFile('/Users/me/.pulse-coder/canvas/default/notes/a.md', storeDir))
      .toEqual({ workspaceId: 'default', relPath: 'notes/a.md' });
    expect(matchRemoteWorkspaceFile('pulse-remote:///default/notes/a.md', storeDir))
      .toEqual({ workspaceId: 'default', relPath: 'notes/a.md' });
  });

  it('keeps project files whose path merely contains the workspace id local', () => {
    expect(matchRemoteWorkspaceFile('/Users/me/code/default/README.md', storeDir)).toBeNull();
  });

  it('never routes files of a workspace that keeps storage local', () => {
    expect(matchRemoteWorkspaceFile('/Users/me/.pulse-coder/canvas/runtime-only/notes/a.md', storeDir))
      .toBeNull();
  });
});
