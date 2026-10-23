#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);

const readArg = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
};

const hasFlag = (name) => args.includes(name);

const version = readArg('--version');
const channel = readArg('--channel') || 'stable';
const product = readArg('--product') || 'pulse-canvas';
const bucket = readArg('--bucket') || process.env.PULSE_CANVAS_R2_BUCKET;
const releaseBaseUrl = readArg('--release-base-url') || process.env.PULSE_CANVAS_RELEASE_BASE_URL;
const historyManifestUrl = readArg('--history-manifest-url');
const currentManifestUrl = readArg('--current-manifest-url');
const downloadUrl = readArg('--download-url') || process.env.PULSE_CANVAS_DOWNLOAD_URL;
const projectName = readArg('--project-name') || process.env.PULSE_CANVAS_PAGES_PROJECT;
const branch = readArg('--branch') || process.env.PULSE_CANVAS_PAGES_BRANCH || 'main';
const arch = readArg('--arch') || 'arm64';
const skipBuild = hasFlag('--no-build');
const skipPublish = hasFlag('--no-publish');
const skipDeploy = hasFlag('--no-deploy');
const dryRun = hasFlag('--dry-run');
const useProxy = hasFlag('--use-proxy');
const manifestOnly = hasFlag('--manifest-only') || hasFlag('--latest-only');
const skipArtifactUpload = manifestOnly || hasFlag('--skip-artifact-upload');
const commitTag = hasFlag('--commit-tag') || hasFlag('--push-git');
const pushGit = hasFlag('--push-git');
const allowDirtyGit = hasFlag('--allow-dirty-git');
const tagPrefix = readArg('--tag-prefix') || 'pulse-canvas-v';
const notesPending = hasFlag('--notes-pending');
const uploadProgressEnabled = !hasFlag('--no-upload-progress');
const uploadProgressIntervalSeconds = Number(readArg('--upload-progress-interval') || process.env.PULSE_CANVAS_UPLOAD_PROGRESS_INTERVAL || '15');
const repoDir = readArg('--repo') || process.env.PULSE_CANVAS_REPO_DIR || process.cwd();
const appDir = join(repoDir, 'apps', 'canvas-workspace');
const notesZh = readArg('--notes-zh') || process.env.PULSE_CANVAS_RELEASE_NOTES_ZH;
const notesEn = readArg('--notes-en') || process.env.PULSE_CANVAS_RELEASE_NOTES_EN;
const notesPlain = readArg('--notes') || process.env.PULSE_CANVAS_RELEASE_NOTES;
const explicitNotes = notesZh || notesEn
  ? {
      ...(notesZh ? { zh: notesZh } : {}),
      ...(notesEn ? { en: notesEn } : {}),
    }
  : notesPlain;
const notes = explicitNotes || (notesPending ? 'Release notes pending diff generation.' : undefined);

// Fail before changing package.json or starting any build/upload.
if (!hasFlag('--self-test-history')) {
  const required = [
    ...(!skipPublish ? [
      ['--bucket / PULSE_CANVAS_R2_BUCKET', bucket],
      ['--release-base-url / PULSE_CANVAS_RELEASE_BASE_URL', releaseBaseUrl],
      ['--download-url / PULSE_CANVAS_DOWNLOAD_URL', downloadUrl],
    ] : []),
    ...(!skipDeploy ? [['--project-name / PULSE_CANVAS_PAGES_PROJECT', projectName]] : []),
  ];
  const missing = required.filter(([, value]) => !value?.trim());
  if (missing.length) {
    throw new Error(`Missing release configuration: ${missing.map(([name]) => name).join(', ')}`);
  }
  for (const [name, value] of [
    ['release base URL', releaseBaseUrl],
    ['download URL', downloadUrl],
    ['history manifest URL', historyManifestUrl],
    ['current manifest URL', currentManifestUrl],
  ]) {
    if (!value) continue;
    let url;
    try {
      url = new URL(value);
    } catch {
      // Do not echo potentially sensitive input in parser diagnostics.
    }
    if (!url || !['https:', 'http:'].includes(url.protocol)
      || url.username || url.password || url.search || url.hash) {
      throw new Error(`${name} must be a public HTTP(S) URL without credentials, query, or fragment.`);
    }
  }
}

const proxyEnvKeys = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
];

const withoutProxyEnv = () => {
  const env = { ...process.env };
  for (const key of proxyEnvKeys) {
    delete env[key];
  }
  return env;
};

const formatCommandPart = (item) => {
  const value = String(item);
  return value.includes(' ') ? JSON.stringify(value) : value;
};

const run = (command, commandArgs, options = {}) => {
  const bypassProxy = command === 'wrangler' && !useProxy;
  const prefix = bypassProxy
    ? ['env', ...proxyEnvKeys.flatMap((key) => ['-u', key])]
    : [];
  const printable = [...prefix, command, ...commandArgs].map(formatCommandPart).join(' ');
  console.log(`$ ${printable}`);
  if (dryRun) return;

  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || appDir,
    env: bypassProxy ? withoutProxyEnv() : process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDuration = (ms) => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const parseByteValue = (value, unit) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const normalized = unit.toLowerCase();
  if (normalized === 'b') return number;
  if (normalized === 'kb' || normalized === 'kib') return number * 1024;
  if (normalized === 'mb' || normalized === 'mib') return number * 1024 * 1024;
  if (normalized === 'gb' || normalized === 'gib') return number * 1024 * 1024 * 1024;
  if (normalized === 'tb' || normalized === 'tib') return number * 1024 * 1024 * 1024 * 1024;
  return 0;
};

const descendantPids = (rootPid) => {
  if (!rootPid) return [];
  const result = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  const childrenByParent = new Map();
  for (const line of result.stdout.split('\n')) {
    const [pidRaw, ppidRaw] = line.trim().split(/\s+/);
    const pid = Number(pidRaw);
    const ppid = Number(ppidRaw);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    const children = childrenByParent.get(ppid) ?? [];
    children.push(pid);
    childrenByParent.set(ppid, children);
  }
  const queue = [...(childrenByParent.get(rootPid) ?? [])];
  const seen = new Set(queue);
  for (let index = 0; index < queue.length; index += 1) {
    const pid = queue[index];
    for (const child of childrenByParent.get(pid) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return [...seen];
};

const sampleNettopBytes = (pids) => {
  if (process.platform !== 'darwin' || pids.length === 0) return undefined;
  const result = spawnSync('nettop', ['-P', '-l', '1', '-J', 'bytes_out,bytes_in'], {
    encoding: 'utf8',
    timeout: 8000,
  });
  if (result.status !== 0 || !result.stdout) return undefined;
  let best = 0;
  for (const line of result.stdout.split('\n')) {
    if (!pids.some((pid) => line.includes(`.${pid}`))) continue;
    const matches = [...line.matchAll(/([\d.]+)\s+([KMGT]?i?B|[KMGT]?B)\b/g)];
    for (const match of matches) {
      best = Math.max(best, parseByteValue(match[1], match[2]));
    }
  }
  return best > 0 ? best : undefined;
};

const runAsync = (command, commandArgs, options = {}) => {
  const bypassProxy = command === 'wrangler' && !useProxy;
  const prefix = bypassProxy
    ? ['env', ...proxyEnvKeys.flatMap((key) => ['-u', key])]
    : [];
  const printable = [...prefix, command, ...commandArgs].map(formatCommandPart).join(' ');
  console.log(`$ ${printable}`);
  if (dryRun) return Promise.resolve();

  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd || appDir,
      env: bypassProxy ? withoutProxyEnv() : process.env,
      stdio: 'inherit',
    });
    const startedAt = Date.now();
    let timer;
    if (options.uploadProgress) {
      const intervalMs = Math.max(5, uploadProgressIntervalSeconds) * 1000;
      const tick = () => {
        const pids = [child.pid, ...descendantPids(child.pid)].filter(Boolean);
        const observed = sampleNettopBytes(pids);
        const elapsed = formatDuration(Date.now() - startedAt);
        const size = options.uploadProgress.size;
        const percent = observed && size
          ? ` (${Math.min(99, Math.round((observed / size) * 100))}%)`
          : '';
        const observedText = observed
          ? `observed network ${formatBytes(observed)} / ${formatBytes(size)}${percent}`
          : `waiting for network sample / ${formatBytes(size)}`;
        console.log(`[upload] ${options.uploadProgress.label}: ${observedText}, elapsed ${elapsed}`);
      };
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
    }
    child.on('exit', (code) => {
      if (timer) clearInterval(timer);
      if (code !== 0) {
        process.exit(code ?? 1);
      }
      resolve();
    });
  });
};

const runUpload = async (file, objectName) => {
  const objectPath = `${bucket}/${product}/${channel}/${objectName}`;
  const size = dryRun && !existsSync(file.path) ? 0 : statSync(file.path).size;
  console.log(`[upload] ${objectName}: ${formatBytes(size)} via ${useProxy ? 'proxy' : 'direct Cloudflare connection'}`);
  await runAsync('wrangler', [
    'r2',
    'object',
    'put',
    objectPath,
    '--file',
    file.path,
    '--remote',
  ], {
    uploadProgress: uploadProgressEnabled && size >= 5 * 1024 * 1024
      ? { label: objectName, size }
      : undefined,
  });
};

const runText = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || repoDir,
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || `${command} failed`;
    throw new Error(detail.trim());
  }
  return result.stdout;
};

const appPackagePath = join(appDir, 'package.json');
const appPackage = JSON.parse(readFileSync(appPackagePath, 'utf8'));
const targetVersion = version || appPackage.version;
const releaseDir = join(appDir, 'release');
const siteDir = join(appDir, 'download-site');
const distDir = join(releaseDir, 'download-site-dist');
const releaseExtensions = new Set(['.AppImage', '.blockmap', '.deb', '.dmg', '.exe', '.json', '.yml', '.zip']);
const trimTrailingSlash = (value) => value.replace(/\/+$/, '');
const releaseBaseUrlFinal = trimTrailingSlash(releaseBaseUrl || '');

const writePackageVersion = (nextVersion) => {
  if (nextVersion === appPackage.version) return;
  if (dryRun) {
    console.log(`[dry-run] write ${appPackagePath} version ${nextVersion}`);
    return;
  }
  writeFileSync(appPackagePath, `${JSON.stringify({ ...appPackage, version: nextVersion }, null, 2)}\n`);
};

const collectReleaseFiles = () => {
  if (!existsSync(releaseDir)) {
    throw new Error(`Release directory does not exist: ${releaseDir}`);
  }

  const all = readdirSync(releaseDir)
    .map((name) => ({ name, path: join(releaseDir, name) }))
    .filter((file) => statSync(file.path).isFile())
    .filter(({ name }) => {
      if (name === 'latest.json') return false;
      if (![...releaseExtensions].some((ext) => name.endsWith(ext))) return false;
      if (/^latest.*\.yml$/i.test(name)) return true;
      return name.includes(targetVersion);
    })
    .filter(({ name }) => {
      if (!arch) return true;
      if (arch === 'arm64') return name.includes('-arm64');
      return name.includes(`-${arch}`) || name.includes(`.${arch}.`);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (all.length === 0) {
    throw new Error(`No release artifacts for version ${targetVersion} found in ${releaseDir}`);
  }
  return all;
};

const encodeFileName = (name) => name.split('/').map(encodeURIComponent).join('/');

const copyTree = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const source = join(from, entry);
    const target = join(to, entry);
    const stats = statSync(source);
    if (stats.isDirectory()) {
      copyTree(source, target);
    } else {
      copyFileSync(source, target);
    }
  }
};

const readJsonIfExists = (path) => {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
};

const fetchJson = async (url, label) => {
  if (!url || dryRun) return {};
  try {
    const target = new URL(url);
    target.searchParams.set('release-history', String(Date.now()));
    const response = await fetch(target, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json();
    console.log(`[release-history] Loaded ${label}: ${target.origin}${target.pathname}`);
    return value && typeof value === 'object' ? value : {};
  } catch (error) {
    console.warn(`[release-history] Could not load ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
};

const selectCurrentReleaseFiles = (manifests, targetVersion) => (
  manifests.find((manifest) => (
    manifest.version === targetVersion && Array.isArray(manifest.files)
  ))?.files ?? []
);

const mergeReleaseHistory = (manifests, currentRelease, limit = 12) => {
  const historicalCandidates = manifests.flatMap((manifest) => (
    Array.isArray(manifest.releases)
      ? manifest.releases
      : manifest.version && manifest.notes
        ? [{ version: manifest.version, releasedAt: manifest.releasedAt, notes: manifest.notes }]
        : []
  ));
  const historicalReleases = historicalCandidates.filter((release, index) => (
    release?.version
    && historicalCandidates.findIndex((candidate) => candidate?.version === release.version) === index
  ));
  return [
    currentRelease,
    ...historicalReleases.filter((release) => release?.version !== currentRelease.version),
  ].slice(0, limit);
};

if (hasFlag('--self-test-history')) {
  const current = {
    version: '0.1.52',
    releasedAt: '2026-09-01T00:00:00.000Z',
    notes: { en: 'current' },
  };
  const currentManifest = {
    ...current,
    files: [{ name: 'Pulse-Canvas-0.1.52-arm64.dmg' }],
    releases: [current],
  };
  const historicalManifest = {
    version: '0.1.51',
    files: [{ name: 'Pulse-Canvas-0.1.51-arm64.dmg' }],
    releases: Array.from({ length: 12 }, (_, index) => ({
      version: `0.1.${51 - index}`,
      releasedAt: `2026-08-${String(30 - index).padStart(2, '0')}T00:00:00.000Z`,
      notes: { en: `release ${51 - index}` },
    })),
  };
  assert.deepEqual(
    selectCurrentReleaseFiles([currentManifest, historicalManifest], current.version),
    currentManifest.files,
  );
  assert.deepEqual(
    mergeReleaseHistory([historicalManifest, currentManifest], current).map((release) => release.version),
    ['0.1.52', '0.1.51', '0.1.50', '0.1.49', '0.1.48', '0.1.47', '0.1.46', '0.1.45', '0.1.44', '0.1.43', '0.1.42', '0.1.41'],
  );
  console.log('release history self-test: ok');
  process.exit(0);
}

const manifestPath = join(releaseDir, 'latest.json');
const targetRepo = repoDir;
const targetVersionFinal = targetVersion;
const gitTagName = readArg('--tag-name') || `${tagPrefix}${targetVersionFinal}`;
const releaseCommitMessage = readArg('--release-commit-message') || `release(canvas): ${targetVersionFinal}`;
const appPackageGitPath = relative(repoDir, appPackagePath);

const assertReleaseNotesReady = () => {
  if (skipPublish) return;
  if (notes) {
    if (notesPending && !explicitNotes) {
      console.warn('[release-note] Using explicit pending release note placeholder. Replace it with generated notes before calling the release complete.');
    }
    return;
  }
  throw new Error(
    [
      'Release notes are required before publishing latest.json.',
      'Pass --notes, --notes-zh/--notes-en, or --notes-pending if you intentionally want a temporary placeholder.',
      'For a note-only repair after artifacts are already uploaded, use --manifest-only --no-build with the final notes.',
    ].join('\n'),
  );
};

const assertGitReleaseReady = () => {
  if (!commitTag) return;
  const status = runText('git', ['status', '--porcelain'], { cwd: repoDir }).trim();
  if (status && !allowDirtyGit) {
    throw new Error(
      [
        'Git working tree is not clean. Commit or stash changes before using --commit-tag/--push-git,',
        'or pass --allow-dirty-git if you intentionally want the release script to continue.',
        status,
      ].join('\n'),
    );
  }
  const existingTag = runText('git', ['tag', '--list', gitTagName], { cwd: repoDir }).trim();
  if (existingTag) {
    throw new Error(`Git tag already exists: ${gitTagName}`);
  }
};

const finalizeGitRelease = () => {
  if (!commitTag) return;
  run('git', ['add', appPackageGitPath], { cwd: repoDir });
  const changedPackage = runText('git', ['status', '--porcelain', '--', appPackageGitPath], { cwd: repoDir }).trim();
  if (changedPackage) {
    run('git', ['commit', '-m', releaseCommitMessage], { cwd: repoDir });
  } else {
    console.log(`No tracked package version change to commit: ${appPackageGitPath}`);
  }
  run('git', ['tag', '-a', gitTagName, '-m', `Pulse Canvas ${targetVersionFinal}`], { cwd: repoDir });
  if (pushGit) {
    const branchName = runText('git', ['branch', '--show-current'], { cwd: repoDir }).trim();
    if (!branchName) throw new Error('Cannot push git release from detached HEAD.');
    run('git', ['push', 'origin', branchName], { cwd: repoDir });
    run('git', ['push', 'origin', gitTagName], { cwd: repoDir });
  }
};

console.log(`\nRelease pipeline for Pulse Canvas`);
console.log(`repo: ${targetRepo}`);
console.log(`appDir: ${appDir}`);
console.log(`version: ${targetVersionFinal}`);
console.log(`channel: ${channel}`);
console.log(`product: ${product}`);
console.log(`arch: ${arch}`);
console.log(`wrangler proxy bypass: ${!useProxy}`);
console.log(`git commit/tag: ${commitTag}`);
console.log(`git push: ${pushGit}`);
if (commitTag) {
  console.log(`git tag: ${gitTagName}`);
  console.log(`git commit: ${releaseCommitMessage}`);
}
console.log(`dry-run: ${dryRun}`);
console.log('');

assertGitReleaseReady();
assertReleaseNotesReady();

if (version) {
  writePackageVersion(targetVersionFinal);
}

if (!skipBuild) {
  run('pnpm', ['package:mac:arm64']);
}

if (!skipPublish) {
  const localManifest = readJsonIfExists(manifestPath);
  const remoteManifest = await fetchJson(
    `${releaseBaseUrlFinal}/latest.json`,
    'remote latest manifest',
  );
  const currentRecoveryManifest = await fetchJson(currentManifestUrl, 'current release recovery manifest');
  const recoveryManifest = await fetchJson(historyManifestUrl, 'history recovery manifest');
  const existingManifests = [recoveryManifest, currentRecoveryManifest, remoteManifest, localManifest];
  const files = manifestOnly ? [] : collectReleaseFiles();
  const existingFiles = selectCurrentReleaseFiles(
    [currentRecoveryManifest, remoteManifest, localManifest, recoveryManifest],
    targetVersionFinal,
  );
  const releaseFiles = manifestOnly
    ? existingFiles
    : files.map((file) => {
        const size = statSync(file.path).size;
        const safeName = file.name.replace(/\s+/g, '-');
        return {
          name: safeName,
          size,
          url: `${releaseBaseUrlFinal}/${encodeFileName(safeName)}`,
        };
      });
  if (manifestOnly && releaseFiles.length === 0) {
    throw new Error('Manifest-only repair could not recover the current release files from local or remote latest.json.');
  }
  console.log(`[release-files] Publishing ${releaseFiles.map((file) => file.name).join(', ')}.`);

  const priorCurrentRelease = existingManifests
    .flatMap((manifest) => Array.isArray(manifest.releases) ? manifest.releases : [])
    .find((release) => release?.version === targetVersionFinal);
  const priorTopLevel = existingManifests.find((manifest) => manifest.version === targetVersionFinal);
  const releasedAt = priorCurrentRelease?.releasedAt
    || priorTopLevel?.releasedAt
    || new Date().toISOString();
  const currentRelease = {
    version: targetVersionFinal,
    releasedAt,
    notes,
  };
  const releases = mergeReleaseHistory(existingManifests, currentRelease);
  console.log(`[release-history] Publishing ${releases.length} release note entr${releases.length === 1 ? 'y' : 'ies'}.`);

  const manifest = {
    version: targetVersionFinal,
    channel,
    releasedAt,
    downloadUrl,
    notes,
    releases,
    files: releaseFiles,
  };
  if (dryRun) {
    console.log(`[dry-run] write ${manifestPath}`);
  } else {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  if (skipArtifactUpload) {
    console.log('[publish] artifact upload skipped; uploading latest.json only.');
  }
  const uploads = skipArtifactUpload
    ? [{ name: 'latest.json', path: manifestPath }]
    : [...files, { name: 'latest.json', path: manifestPath }];
  for (const file of uploads) {
    const objectName = file.name === 'latest.json'
      ? file.name
      : file.name.replace(/\s+/g, '-');
    await runUpload(file, objectName);
  }
}

if (!skipDeploy) {
  if (dryRun) {
    console.log(`[dry-run] prepare download site at ${distDir}`);
  } else {
    rmSync(distDir, { recursive: true, force: true });
    copyTree(siteDir, distDir);
    const iconSource = join(appDir, 'src', 'renderer', 'public', 'icon.png');
    if (existsSync(iconSource)) {
      copyFileSync(iconSource, join(distDir, 'icon.png'));
    }
    const manifestSource = existsSync(manifestPath)
      ? manifestPath
      : join(siteDir, 'latest.sample.json');
    copyFileSync(manifestSource, join(distDir, 'latest.json'));
    const indexPath = join(distDir, 'index.html');
    const indexHtml = readFileSync(indexPath, 'utf8').replace(
      /__PULSE_CANVAS_MANIFEST_URL__/g,
      '/latest.json',
    );
    writeFileSync(indexPath, indexHtml);
  }

  run('wrangler', [
    'pages',
    'deploy',
    distDir,
    '--project-name',
    projectName,
    '--branch',
    branch,
    '--commit-dirty=true',
  ]);
}

console.log('\nDone.');
if (releaseBaseUrlFinal) console.log(`manifest: ${releaseBaseUrlFinal}/latest.json`);
if (downloadUrl) {
  console.log(`download page: ${downloadUrl}/`);
  console.log(`install path: ${downloadUrl}/#install`);
}
console.log(`release file dir: ${appDir}/release`);
if (!commitTag) {
  console.log('');
  console.log(`No release tag yet. Rerun with --commit-tag, or tag the release by hand: git tag -a ${gitTagName} -m "Pulse Canvas ${targetVersionFinal}"`);
}

finalizeGitRelease();

if (dryRun) {
  console.log('\nDry run complete, no changes were applied.');
}
