import { promises as fs } from 'fs';
import { join } from 'path';
import { getWorkspaceDir, isSafeWorkspaceId, loadWorkspaceManifest } from './store';

/**
 * Environment variable the canvas app sets for launched agents so they can
 * address the workspace they were spawned from without a `--workspace` flag.
 */
export const ENV_WORKSPACE_ID = 'PULSE_CANVAS_WORKSPACE_ID';

/**
 * Where a resolved workspace id came from. Surfaced to callers (and to
 * `workspace current`) so an agent can tell whether it was pinned explicitly
 * or fell back to the app's active workspace.
 */
export type WorkspaceResolutionSource =
  | 'explicit'
  | 'environment'
  | 'manifest-active';

export interface WorkspaceResolution {
  workspaceId: string;
  source: WorkspaceResolutionSource;
}

function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}

/**
 * Confirm a candidate id names a real, readable workspace before any command
 * acts on it. Checks, in order:
 *   1. the id is shape-safe (`isSafeWorkspaceId`);
 *   2. the workspace directory holds a readable `canvas.json` (falling back to
 *      the rolling `canvas.json.bak` so a mid-flush corruption still resolves,
 *      matching `loadCanvas`'s self-healing behavior).
 *
 * Throws with an actionable message on any failure — notably, when a manifest's
 * `activeId` points at a workspace that no longer exists we surface that rather
 * than silently picking a different one (writing to the wrong canvas is worse
 * than a hard error).
 */
async function validateWorkspace(
  workspaceId: string,
  source: WorkspaceResolutionSource,
  storeDir?: string,
  requireReadableCanvas = true,
): Promise<WorkspaceResolution> {
  if (!isSafeWorkspaceId(workspaceId)) {
    throw new Error(
      `Unsafe workspace id "${workspaceId}" (from ${describeSource(source)}).`,
    );
  }

  const dir = getWorkspaceDir(workspaceId, storeDir);

  // `restore` recovers workspaces whose canvas.json is missing or clobbered,
  // so it opts out of the readability check — a safe id is enough there.
  if (!requireReadableCanvas) {
    return { workspaceId, source };
  }

  const canvasFile = join(dir, 'canvas.json');

  let primaryErr: unknown = null;
  try {
    await fs.readFile(canvasFile, 'utf-8');
    return { workspaceId, source };
  } catch (err) {
    if (!isEnoent(err)) primaryErr = err;
  }

  // Primary missing or unreadable — accept a recoverable `.bak` snapshot so a
  // workspace mid-corruption is still addressable (loadCanvas would heal it).
  try {
    await fs.readFile(`${canvasFile}.bak`, 'utf-8');
    return { workspaceId, source };
  } catch {
    if (primaryErr) {
      throw new Error(
        `Workspace "${workspaceId}" (from ${describeSource(source)}) has an ` +
        `unreadable canvas.json: ${String(primaryErr)}`,
      );
    }
    throw new Error(
      `Workspace "${workspaceId}" (from ${describeSource(source)}) not found ` +
      `at ${dir}.`,
    );
  }
}

function describeSource(source: WorkspaceResolutionSource): string {
  switch (source) {
    case 'explicit':
      return '--workspace';
    case 'environment':
      return `$${ENV_WORKSPACE_ID}`;
    case 'manifest-active':
      return 'active workspace';
  }
}

/**
 * Resolve which workspace a command should act on. Resolution order is fixed
 * and deliberately conservative — it never guesses (no "most recently
 * modified" or "first in the list"), because addressing the wrong canvas
 * silently corrupts a user's work:
 *
 *   1. `--workspace <id>` (explicit)
 *   2. `$PULSE_CANVAS_WORKSPACE_ID` (environment)
 *   3. `__workspaces__.json.activeId` (the app's active workspace)
 *   4. otherwise a hard error telling the caller how to select one.
 *
 * Every resolved candidate is validated (`validateWorkspace`) before it is
 * returned, so callers can trust the id points at a readable workspace.
 */
export async function resolveWorkspaceId(options: {
  explicitId?: string;
  storeDir?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Require the resolved workspace to have a readable `canvas.json`. Default
   * `true`. `restore` sets this `false` because it recovers workspaces whose
   * canvas.json is precisely what's broken.
   */
  requireReadableCanvas?: boolean;
}): Promise<WorkspaceResolution> {
  const requireReadableCanvas = options.requireReadableCanvas ?? true;

  const explicit = options.explicitId?.trim();
  if (explicit) {
    return validateWorkspace(explicit, 'explicit', options.storeDir, requireReadableCanvas);
  }

  const environment = (options.env ?? process.env)[ENV_WORKSPACE_ID]?.trim();
  if (environment) {
    return validateWorkspace(environment, 'environment', options.storeDir, requireReadableCanvas);
  }

  const manifest = await loadWorkspaceManifest(options.storeDir);
  if (manifest.activeId) {
    return validateWorkspace(manifest.activeId, 'manifest-active', options.storeDir, requireReadableCanvas);
  }

  throw new Error(
    'No workspace selected. Open a workspace in Pulse Canvas, ' +
    `pass --workspace <id>, or set $${ENV_WORKSPACE_ID}.`,
  );
}
