import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { HarnessError } from './errors.mjs';
import { waitFor } from './utils.mjs';

/**
 * Headless-Linux display management.
 *
 * On a display-less Linux host (CI, containers, cloud sandboxes) the harness
 * can own a virtual X server — but ONLY when the user opts in with
 * `--headless`; spawning an X server (and disabling the Electron sandbox)
 * is never something to do implicitly. Without the flag, a missing DISPLAY
 * fails fast with a hint instead of a cryptic Electron crash. The spawned
 * Xvfb pid is recorded in the session so `close` reaps it.
 */

const displaySocket = (n) => `/tmp/.X11-unix/X${n}`;
const displayLock = (n) => `/tmp/.X${n}-lock`;

const pickFreeDisplay = () => {
  for (let n = 99; n < 140; n++) {
    if (!existsSync(displaySocket(n)) && !existsSync(displayLock(n))) return n;
  }
  throw new HarnessError('No free X display number between :99 and :139.');
};

export const shouldRunHeadless = (opts) => opts.headless === true;

/** Fail fast (with the fix) when a launch cannot possibly show a window. */
export const assertDisplayAvailable = () => {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    throw new HarnessError(
      'No DISPLAY on this Linux host. Pass --headless to let the harness manage an Xvfb display '
      + '(requires xvfb; debian/ubuntu: `apt-get install -y xvfb`).',
    );
  }
};

/**
 * Ensure a DISPLAY exists for a headless launch. Returns
 * `{ display, xvfbPid }` when this call spawned Xvfb (caller must record the
 * pid for cleanup), or `{ display, xvfbPid: undefined }` when an external
 * DISPLAY was already usable.
 */
export async function ensureHeadlessDisplay() {
  if (process.env.DISPLAY) {
    return { display: process.env.DISPLAY, xvfbPid: undefined };
  }
  const n = pickFreeDisplay();
  let child;
  try {
    child = spawn('Xvfb', [`:${n}`, '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], {
      detached: true,
      stdio: 'ignore',
    });
  } catch (err) {
    throw new HarnessError(`Failed to spawn Xvfb: ${err.message}`);
  }
  child.on('error', () => {
    /* surfaced via the readiness timeout below */
  });
  child.unref();
  await waitFor(() => existsSync(displaySocket(n)), 8_000).catch(() => {
    throw new HarnessError(
      'Xvfb did not come up within 8s. Is it installed? (debian/ubuntu: `apt-get install -y xvfb`)',
    );
  });
  return { display: `:${n}`, xvfbPid: child.pid };
}
