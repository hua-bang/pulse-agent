import electronPath from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  APP_DIR,
  DEFAULT_TIMEOUT_MS,
  DIST_MAIN,
  DIST_RENDERER,
  HARNESS_DIR,
} from './config.mjs';
import { parseArgs } from './args.mjs';
import { HarnessError } from './errors.mjs';
import { printResult } from './output.mjs';
import { applyStartupNavigation } from './navigation.mjs';
import { readSession, stopSession, writeSession } from './session.mjs';
import { ensureHeadlessDisplay, shouldRunHeadless } from './headless.mjs';
import { collectFlags, prepareProfile, writeExperimentalFlags } from './profiles.mjs';
import { getFreePort, isPidAlive } from './utils.mjs';
import { waitForPageTarget } from './cdp.mjs';

export async function startCommand(rawArgs) {
  const { opts } = parseArgs(rawArgs);
  const existing = await readSession().catch(() => null);
  if (existing && isPidAlive(existing.pid)) {
    if (!opts.force) {
      throw new HarnessError(`Harness session already running (pid ${existing.pid}). Use --force or close it first.`);
    }
    await stopSession(existing, { cleanup: false });
  }

  if (opts.build) {
    const result = spawnSync('pnpm', ['run', 'build'], { cwd: APP_DIR, stdio: 'inherit' });
    if (result.status !== 0) throw new HarnessError('Build failed; harness launch aborted.');
  }

  if (!existsSync(DIST_MAIN) || !existsSync(DIST_RENDERER)) {
    throw new HarnessError(
      'Built canvas-workspace files are missing. Run `pnpm --filter canvas-workspace build` or start with `--build`.',
    );
  }

  await fs.mkdir(HARNESS_DIR, { recursive: true });
  const profile = opts.profile ?? 'temp';
  const id = `harness-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const artifactsDir = join(HARNESS_DIR, 'runs', id);
  await fs.mkdir(artifactsDir, { recursive: true });

  const profileInfo = await prepareProfile(profile, opts, artifactsDir);
  const flags = collectFlags(opts);
  const flagsPath = flags.length ? await writeExperimentalFlags(flags, artifactsDir) : undefined;
  const cdpPort = await getFreePort();
  const electronUserDataDir = join(artifactsDir, 'electron-user-data');
  await fs.mkdir(electronUserDataDir, { recursive: true });
  const stdoutPath = join(artifactsDir, 'electron.stdout.log');
  const stderrPath = join(artifactsDir, 'electron.stderr.log');
  const stdoutFd = openSync(stdoutPath, 'a');
  const stderrFd = openSync(stderrPath, 'a');
  // Headless Linux (CI/containers): own an Xvfb display and disable the
  // Electron sandbox for the child. Forced via --headless; automatic when
  // Linux has no DISPLAY.
  const headless = shouldRunHeadless(opts);
  const headlessDisplay = headless ? await ensureHeadlessDisplay() : null;
  const env = {
    ...process.env,
    HOME: profileInfo.home,
    ...(flagsPath ? { PULSE_CANVAS_EXPERIMENTAL_FEATURES: flagsPath } : {}),
    ...(headlessDisplay
      ? { DISPLAY: headlessDisplay.display, ELECTRON_DISABLE_SANDBOX: '1' }
      : {}),
  };
  delete env.ELECTRON_RENDERER_URL;
  delete env.VITE_DEV_SERVER_URL;
  const child = spawn(electronPath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${electronUserDataDir}`,
    APP_DIR,
  ], {
    cwd: APP_DIR,
    env,
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
  });
  closeSync(stdoutFd);
  closeSync(stderrFd);
  child.unref();

  const session = {
    schemaVersion: 1,
    id,
    profile,
    mode: 'built',
    pid: child.pid,
    cdpPort,
    appDir: APP_DIR,
    electronUserDataDir,
    home: profileInfo.home,
    workspaceId: profileInfo.workspaceId,
    sourceWorkspaceId: profileInfo.sourceWorkspaceId,
    cleanupHome: profileInfo.cleanupHome,
    startedAt: new Date().toISOString(),
    artifactsDir,
    flags,
    target: opts.target ?? undefined,
    route: opts.route ?? undefined,
    logFiles: { stdout: stdoutPath, stderr: stderrPath },
    ...(headlessDisplay
      ? { headless: true, display: headlessDisplay.display, xvfbPid: headlessDisplay.xvfbPid }
      : {}),
  };

  try {
    await waitForPageTarget(session, DEFAULT_TIMEOUT_MS);
    await applyStartupNavigation(session, opts);
  } catch (err) {
    await stopSession(session, { cleanup: profileInfo.cleanupHome });
    throw err;
  }

  await writeSession(session);
  printResult(opts.json, session, [
    `Started Pulse Canvas harness session ${session.id}`,
    `profile=${session.profile}`,
    `pid=${session.pid}`,
    `home=${session.home}`,
    `artifacts=${session.artifactsDir}`,
  ]);
}
