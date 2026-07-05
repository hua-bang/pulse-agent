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

export async function stopSession(session, { cleanup }) {
  if (isPidAlive(session.pid)) {
    process.kill(session.pid, 'SIGTERM');
    await waitFor(() => !isPidAlive(session.pid), 5_000).catch(() => {
      if (isPidAlive(session.pid)) process.kill(session.pid, 'SIGKILL');
    });
  }
  if (cleanup && session.cleanupHome && session.home && session.home.includes('pulse-canvas-harness-')) {
    await fs.rm(session.home, { recursive: true, force: true });
  }
}

export async function clearCurrentSession() {
  await fs.rm(CURRENT_SESSION_PATH, { force: true });
}
