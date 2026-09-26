import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { CURRENT_SESSION_PATH, HARNESS_DIR } from './config.mjs';
import { HarnessError } from './errors.mjs';
import { isPidAlive, waitFor } from './utils.mjs';

export async function readSession() {
  const raw = await fs.readFile(CURRENT_SESSION_PATH, 'utf8');
  return JSON.parse(raw);
}

export async function requireSession() {
  try {
    return await readSession();
  } catch {
    throw new HarnessError('No current harness session. Run `pnpm --filter canvas-workspace harness start` first.');
  }
}

export async function requireLiveSession() {
  const session = await requireSession();
  if (!isPidAlive(session.pid)) throw new HarnessError(`Harness session is not running (pid ${session.pid}).`);
  return session;
}

export async function writeSession(session) {
  await fs.mkdir(HARNESS_DIR, { recursive: true });
  await fs.writeFile(CURRENT_SESSION_PATH, JSON.stringify(session, null, 2));
}

/**
 * POSIX signals a detached process group via a negative pid. Windows has no
 * process groups for process.kill (a negative pid throws), so a tree is
 * stopped with `taskkill /T`, which has no graceful form: SIGTERM is /F too.
 */
export function stopProcess(session, signal, {
  platform = process.platform,
  kill = process.kill.bind(process),
  run = spawnSync,
} = {}) {
  if (session.processGroup && platform === 'win32') {
    run('taskkill', ['/pid', String(session.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    kill(session.processGroup ? -session.pid : session.pid, signal);
  } catch { /* already gone */ }
}

export async function stopSession(session, { cleanup }) {
  if (isPidAlive(session.pid)) {
    // Dev sessions stop the whole tree so electron-vite's Electron child and
    // dev server die with it instead of outliving the session.
    const signal = (name) => stopProcess(session, name);
    signal('SIGTERM');
    await waitFor(() => !isPidAlive(session.pid), 5_000).catch(() => {
      if (isPidAlive(session.pid)) signal('SIGKILL');
    });
  }
  // Reap the Xvfb we spawned for a headless session (never an external DISPLAY).
  if (session.xvfbPid && isPidAlive(session.xvfbPid)) {
    try { process.kill(session.xvfbPid, 'SIGTERM'); } catch { /* already gone */ }
  }
  if (cleanup && session.cleanupHome && session.home && session.home.includes('pulse-canvas-harness-')) {
    await fs.rm(session.home, { recursive: true, force: true });
  }
}

export async function clearCurrentSession() {
  await fs.rm(CURRENT_SESSION_PATH, { force: true });
}
