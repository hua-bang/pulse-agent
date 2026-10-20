import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./release-pulse-canvas.mjs', import.meta.url));
const temporaryRepos = [];
const deployment = {
  PULSE_CANVAS_R2_BUCKET: 'example-bucket',
  PULSE_CANVAS_RELEASE_BASE_URL: 'https://downloads.example.com/pulse-canvas/stable',
  PULSE_CANVAS_DOWNLOAD_URL: 'https://download.example.com',
  PULSE_CANVAS_PAGES_PROJECT: 'example-project',
};

afterEach(() => {
  for (const repo of temporaryRepos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

function fixture() {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'release skill 中文 ')));
  temporaryRepos.push(repo);
  const app = join(repo, 'apps/canvas-workspace');
  mkdirSync(join(app, 'release'), { recursive: true });
  const packagePath = join(app, 'package.json');
  writeFileSync(packagePath, '{"version":"1.0.0"}\n');
  writeFileSync(join(app, 'release/Pulse Canvas-1.0.1-arm64.dmg'), 'fixture');
  // No request may leave the process, even during a dry run.
  const guard = join(repo, 'network-guard.mjs');
  writeFileSync(guard, 'globalThis.fetch = () => process.exit(91);\n');
  return { repo, app, packagePath, guard };
}

function invoke(f, args, env = {}) {
  return spawnSync(process.execPath, ['--import', f.guard, script, ...args], {
    cwd: f.repo,
    // External tools cannot run; no local credentials enter the test.
    env: { PATH: '', ...env },
    encoding: 'utf8',
    timeout: 10000,
  });
}

describe('portable release configuration', () => {
  it.each(Object.keys(deployment))('requires %s before mutating or building', (key) => {
    const f = fixture();
    const env = { ...deployment };
    delete env[key];
    const result = invoke(f, ['--version', '1.0.1', '--notes', 'Example'], env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing release configuration');
    expect(result.stderr).toContain(key);
    expect(readFileSync(f.packagePath, 'utf8')).toBe('{"version":"1.0.0"}\n');
    expect(result.stdout).not.toContain('$ pnpm');
  });

  it('previews publication from the current repo without writes, commands, or network', () => {
    const f = fixture();
    const result = invoke(f, ['--version', '1.0.1', '--notes', 'Example', '--dry-run'], deployment);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`repo: ${f.repo}`);
    expect(result.stdout).toContain('pnpm package:mac:arm64');
    expect(result.stdout).toContain('example-bucket/pulse-canvas/stable/latest.json');
    expect(result.stdout).toContain('--project-name example-project');
    expect(result.stdout).toContain('Dry run complete');
    expect(readFileSync(f.packagePath, 'utf8')).toBe('{"version":"1.0.0"}\n');
    expect(readdirSync(join(f.app, 'release'))).toEqual(['Pulse Canvas-1.0.1-arm64.dmg']);
  });

  it('gives explicit configuration precedence over environment values', () => {
    const f = fixture();
    const result = invoke(f, [
      '--repo', f.repo, '--version', '1.0.1', '--notes', 'Example', '--dry-run',
      '--bucket', 'override-bucket',
      '--project-name', 'override-project',
      '--release-base-url', 'https://artifacts.example.org/pulse-canvas/stable',
      '--download-url', 'https://site.example.org',
    ], { ...deployment, PULSE_CANVAS_REPO_DIR: '/nonexistent-repo' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('override-bucket/pulse-canvas/stable/latest.json');
    expect(result.stdout).toContain('--project-name override-project');
    expect(result.stdout).toContain('manifest: https://artifacts.example.org/pulse-canvas/stable/latest.json');
    expect(result.stdout).toContain('download page: https://site.example.org/');
  });

  it('allows build-only preview and history self-test without cloud configuration', () => {
    const f = fixture();
    const preview = invoke(f, ['--no-publish', '--no-deploy', '--dry-run']);
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toContain('pnpm package:mac:arm64');
    const history = invoke(f, ['--self-test-history']);
    expect(history.status, history.stderr).toBe(0);
    expect(history.stdout).toContain('release history self-test: ok');
  });

  it('previews manifest-only repair from local history without network', () => {
    const f = fixture();
    const manifestPath = join(f.app, 'release/latest.json');
    const manifest = JSON.stringify({
      version: '1.0.0',
      files: [{ name: 'Pulse-Canvas-1.0.0-arm64.dmg' }],
      notes: 'Original',
    });
    writeFileSync(manifestPath, manifest);
    const result = invoke(f, ['--manifest-only', '--no-build', '--notes', 'Updated', '--dry-run'], deployment);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('artifact upload skipped');
    expect(result.stdout).toContain('example-bucket/pulse-canvas/stable/latest.json');
    expect(readFileSync(manifestPath, 'utf8')).toBe(manifest);
  });

  it.each([
    'https://user:private-value@example.com/releases',
    'https://example.com/releases?token=private-value',
    'https://example.com/releases#private-value',
    'invalid-private-value',
  ])('rejects non-public URL configuration without echoing its value', (url) => {
    const f = fixture();
    const result = invoke(f, ['--version', '1.0.1', '--notes', 'Example'], {
      ...deployment, PULSE_CANVAS_RELEASE_BASE_URL: url,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must be a public HTTP(S) URL');
    expect(result.stderr + result.stdout).not.toContain('private-value');
    expect(readFileSync(f.packagePath, 'utf8')).toBe('{"version":"1.0.0"}\n');
  });
});
