/**
 * `pulse-canvas restore` — recover a workspace from a v1-shape canvas.json
 * snapshot.
 *
 * Intended for the scenario where a v1-unaware writer (old binary or
 * external script) has clobbered the canvas.json of a v2 workspace,
 * leaving per-node files in `nodes/<id>.json` intact but the canvas
 * index in an unusable state. The pollution guard in canvas-workspace
 * (`CanvasPollutionDetectedError`) refuses to migrate such a workspace,
 * so the user needs a deliberate, scriptable recovery path — this is
 * it.
 *
 * Two subcommands:
 *
 *   restore list [workspaceId]
 *     Lists every v1 snapshot found under the workspace directory —
 *     the stable `canvas.json.v1.bak` alias and every immutable
 *     `canvas.json.v1.<ISO>.bak` archive that the migration code
 *     writes. Useful to pick a `--from` source.
 *
 *   restore apply [workspaceId] --from <path> [--dry-run] [--yes]
 *     Replaces the current canvas.json with the bytes from `<path>` and
 *     archives the live `nodes/` directory out of the way (so the v2
 *     app's lazy migration runs cleanly on next open). Always writes
 *     pre-restore backups so this command is itself reversible.
 *
 * Deliberately does NOT migrate or touch nodes/<id>.json contents —
 * that's the v2 app's job. canvas-cli stays format-preservation only.
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
  getWorkspaceDir,
  ensureWorkspaceDir,
} from '../core/store';
import { resolveWorkspaceId } from '../core/workspace-resolution';
import { getRootOptions } from './options';
import { detectSchemaVersion } from '../core/storage-v2';
import type { CanvasSaveData } from '../core/types';
import { output, errorOutput, type OutputFormat } from '../output';

/**
 * Resolve the workspace `restore` should act on. A positional `[workspaceId]`
 * wins; otherwise fall back to the shared discovery order (`--workspace` → env
 * → active workspace). Crucially, `restore` does NOT require a readable
 * canvas.json — recovering a broken/missing canvas is exactly why it exists.
 */
async function resolveRestoreOptions(
  cmd: Command,
  positionalArg: string | undefined,
): Promise<{ format: OutputFormat; storeDir?: string; workspaceId: string }> {
  const root = getRootOptions(cmd);
  const positional = positionalArg?.trim();
  try {
    const resolution = await resolveWorkspaceId({
      explicitId: positional || root.workspace,
      storeDir: root.storeDir,
      requireReadableCanvas: false,
    });
    return { format: root.format, storeDir: root.storeDir, workspaceId: resolution.workspaceId };
  } catch (err) {
    errorOutput((err as Error).message);
  }
}

interface SnapshotEntry {
  path: string;
  filename: string;
  isStableAlias: boolean;
  /** ISO timestamp parsed from the filename (timestamped archives only). */
  isoTimestamp: string | null;
  sizeBytes: number;
  mtimeIso: string;
  nodeCount: number | null;
  /** True if the snapshot parses cleanly as a v1-shape canvas. */
  isV1Shape: boolean;
}

/**
 * `canvas.json.v1.<ISO-stamp-with-dashes>.bak` — recovers the original
 * ISO 8601 string. Returns null when the file isn't a timestamped
 * archive (e.g. plain `canvas.json.v1.bak`).
 */
function parseTimestampedSnapshotName(filename: string): string | null {
  const m = filename.match(
    /^canvas\.json\.v1\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.bak$/,
  );
  if (!m) return null;
  // Convert `2026-05-25T09-30-42-123Z` back to a real ISO string with
  // colons and dot. Filesystem-friendly format ↔ ISO is a deterministic
  // dash-swap.
  return m[1].replace(
    /^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1$2:$3:$4.$5Z',
  );
}

async function inspectSnapshot(path: string): Promise<{
  sizeBytes: number;
  mtimeIso: string;
  nodeCount: number | null;
  isV1Shape: boolean;
}> {
  const stat = await fs.stat(path);
  let nodeCount: number | null = null;
  let isV1Shape = false;
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as CanvasSaveData;
    if (Array.isArray(parsed.nodes)) nodeCount = parsed.nodes.length;
    isV1Shape = detectSchemaVersion(parsed) !== 2;
  } catch {
    // Leave nodeCount null / isV1Shape false.
  }
  return {
    sizeBytes: stat.size,
    mtimeIso: stat.mtime.toISOString(),
    nodeCount,
    isV1Shape,
  };
}

async function listSnapshots(workspaceDir: string): Promise<SnapshotEntry[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(workspaceDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const candidates = entries.filter(
    (name) => name === 'canvas.json.v1.bak' || /^canvas\.json\.v1\..+\.bak$/.test(name),
  );

  const snapshots: SnapshotEntry[] = await Promise.all(
    candidates.map(async (filename) => {
      const path = join(workspaceDir, filename);
      const isoTimestamp = parseTimestampedSnapshotName(filename);
      const meta = await inspectSnapshot(path);
      return {
        path,
        filename,
        isStableAlias: filename === 'canvas.json.v1.bak',
        isoTimestamp,
        ...meta,
      };
    }),
  );

  // Stable alias surfaces first because it's the documented "latest
  // known good" pointer. Among timestamped archives, sort newest first
  // by the ISO stamp encoded in the filename — that's the migration
  // startedAt and is stable even if the file's mtime gets touched
  // (e.g., by a backup tool). mtime is used only as a fallback for
  // weirdly-named archives we couldn't parse a timestamp from.
  snapshots.sort((a, b) => {
    if (a.isStableAlias && !b.isStableAlias) return -1;
    if (!a.isStableAlias && b.isStableAlias) return 1;
    if (a.isoTimestamp && b.isoTimestamp) {
      return b.isoTimestamp.localeCompare(a.isoTimestamp);
    }
    if (a.isoTimestamp) return -1;
    if (b.isoTimestamp) return 1;
    return b.mtimeIso.localeCompare(a.mtimeIso);
  });
  return snapshots;
}

interface RestorePlan {
  workspaceId: string;
  workspaceDir: string;
  sourcePath: string;
  sourceNodeCount: number;
  /** Where the current canvas.json will be copied before being overwritten. */
  canvasBackupPath: string;
  /** Where the current `nodes/` dir will be renamed to (null if no nodes/ exists). */
  nodesArchivePath: string | null;
  /** Count of files currently in `nodes/` (only set when nodesArchivePath is non-null). */
  nodesArchiveFileCount: number;
  /** Set when the current canvas.json already parses to v2 — restore demotes it back to v1 layout. */
  currentIsV2: boolean;
}

async function planRestore(
  workspaceId: string,
  workspaceDir: string,
  sourcePath: string,
): Promise<RestorePlan> {
  // 1. Validate source.
  let sourceRaw: string;
  try {
    sourceRaw = await fs.readFile(sourcePath, 'utf-8');
  } catch (err) {
    errorOutput(`Cannot read --from path "${sourcePath}": ${String(err)}`);
  }
  let sourceParsed: CanvasSaveData;
  try {
    sourceParsed = JSON.parse(sourceRaw) as CanvasSaveData;
  } catch (err) {
    errorOutput(`--from file is not valid JSON: ${String(err)}`);
  }
  if (!Array.isArray(sourceParsed.nodes)) {
    errorOutput('--from JSON has no `nodes` array — refusing to restore from a corrupt snapshot.');
  }
  if (detectSchemaVersion(sourceParsed) === 2) {
    errorOutput(
      '--from file is a v2 layout (schemaVersion === 2), not a v1 snapshot. ' +
        'Restore only accepts v1-shape full-data backups (the .v1.bak files). ' +
        'Restoring from a v2 layout would write an empty-data canvas.',
    );
  }

  // 2. Inspect current canvas.json so we can name backups and describe
  //    the diff.
  const canvasPath = join(workspaceDir, 'canvas.json');
  let currentRaw: string | null = null;
  let currentIsV2 = false;
  try {
    currentRaw = await fs.readFile(canvasPath, 'utf-8');
    const currentParsed = JSON.parse(currentRaw) as CanvasSaveData;
    currentIsV2 = detectSchemaVersion(currentParsed) === 2;
  } catch (err) {
    // Missing or unparseable — nothing to back up beyond what's there.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        `[restore] current canvas.json unreadable (${String(err)}); will overwrite without backup.`,
      );
    }
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const canvasBackupPath = join(workspaceDir, `canvas.json.pre-restore.${ts}.bak`);

  // 3. nodes/ archive plan.
  const nodesDir = join(workspaceDir, 'nodes');
  let nodesArchivePath: string | null = null;
  let nodesArchiveFileCount = 0;
  try {
    const nodeFiles = await fs.readdir(nodesDir);
    if (nodeFiles.length > 0) {
      nodesArchivePath = join(workspaceDir, `nodes.pre-restore.${ts}`);
      nodesArchiveFileCount = nodeFiles.length;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  return {
    workspaceId,
    workspaceDir,
    sourcePath,
    sourceNodeCount: sourceParsed.nodes!.length,
    canvasBackupPath,
    nodesArchivePath,
    nodesArchiveFileCount,
    currentIsV2,
  };
}

async function applyRestorePlan(plan: RestorePlan): Promise<void> {
  // a. Backup current canvas.json (best-effort — copy fails ENOENT
  //    quietly if there's nothing to back up).
  try {
    await fs.copyFile(
      join(plan.workspaceDir, 'canvas.json'),
      plan.canvasBackupPath,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  // b. Archive nodes/ out of the way so the v2 app's lazy migration
  //    runs against a fresh state and doesn't trip the pollution guard.
  //    Rename rather than delete: cheap, atomic, and reversible by the
  //    user (`mv nodes.pre-restore.* nodes`).
  if (plan.nodesArchivePath) {
    await fs.rename(
      join(plan.workspaceDir, 'nodes'),
      plan.nodesArchivePath,
    );
  }

  // c. Overwrite canvas.json with the source bytes (NOT the parsed
  //    value) so the original formatting / field order is preserved
  //    exactly. The destination is guaranteed-writable because we just
  //    copied it to the .pre-restore.bak above.
  const sourceBytes = await fs.readFile(plan.sourcePath, 'utf-8');
  await fs.writeFile(join(plan.workspaceDir, 'canvas.json'), sourceBytes, 'utf-8');

  // d. Remove any stale `.migrating` sentinel left by an interrupted
  //    migration — it would otherwise trip recovery on the next open.
  await fs.unlink(join(plan.workspaceDir, '.migrating')).catch(() => undefined);
}

async function confirmPrompt(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    errorOutput(`${message} (running non-interactively; pass --yes to confirm)`);
  }
  process.stdout.write(`${message} [y/N] `);
  return new Promise((resolve) => {
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', (chunk) => {
      const ans = String(chunk).trim().toLowerCase();
      resolve(ans === 'y' || ans === 'yes');
    });
  });
}

export function registerRestoreCommand(program: Command): void {
  const restore = program
    .command('restore')
    .description('Recover a workspace from a v1-shape canvas.json snapshot');

  restore
    .command('list [workspaceId]')
    .description('List available v1 snapshots for a workspace')
    .action(async function (this: Command, workspaceArg?: string) {
      const { format, storeDir, workspaceId } = await resolveRestoreOptions(this, workspaceArg);
      const workspaceDir = getWorkspaceDir(workspaceId, storeDir);
      const snapshots = await listSnapshots(workspaceDir);

      output(snapshots, format, (data) => {
        const items = data as SnapshotEntry[];
        if (items.length === 0) {
          return `No v1 snapshots found in ${workspaceDir}`;
        }
        const lines = items.map((s) => {
          const tag = s.isStableAlias
            ? '(stable alias)'
            : s.isoTimestamp
              ? `(archived ${s.isoTimestamp})`
              : '';
          const sizeKb = (s.sizeBytes / 1024).toFixed(1);
          const nodes = s.nodeCount === null ? 'unparseable' : `${s.nodeCount} nodes`;
          const shape = s.isV1Shape ? 'v1' : 'NOT v1 (would refuse)';
          return `  ${s.filename}  ${tag}\n    ${sizeKb} KB · ${nodes} · ${shape} · mtime ${s.mtimeIso}`;
        });
        return `Snapshots for ${workspaceId}:\n${lines.join('\n\n')}`;
      });
    });

  restore
    .command('apply [workspaceId]')
    .description('Restore a workspace by replacing canvas.json with the given v1 snapshot')
    .requiredOption('--from <path>', 'Path to a v1-shape canvas.json snapshot to restore from')
    .option('--dry-run', 'Print the restore plan without writing anything', false)
    .option('-y, --yes', 'Skip the interactive confirmation prompt', false)
    .action(async function (
      this: Command,
      workspaceArg: string | undefined,
      cmdOpts: { from: string; dryRun: boolean; yes: boolean },
    ) {
      const { format, storeDir, workspaceId } = await resolveRestoreOptions(this, workspaceArg);
      const workspaceDir = getWorkspaceDir(workspaceId, storeDir);
      await ensureWorkspaceDir(workspaceId, storeDir);

      const plan = await planRestore(workspaceId, workspaceDir, cmdOpts.from);

      const planSummary = {
        workspaceId: plan.workspaceId,
        workspaceDir: plan.workspaceDir,
        source: plan.sourcePath,
        sourceNodeCount: plan.sourceNodeCount,
        currentSchemaVersion: plan.currentIsV2 ? 2 : 1,
        canvasBackup: plan.canvasBackupPath,
        nodesArchive: plan.nodesArchivePath,
        nodesArchivedFileCount: plan.nodesArchiveFileCount,
        applied: false,
      };

      if (cmdOpts.dryRun) {
        output({ ...planSummary, dryRun: true }, format, (data) => {
          const p = data as typeof planSummary & { dryRun: boolean };
          return [
            `[DRY RUN] Restore plan for "${p.workspaceId}":`,
            `  Source:               ${p.source}  (${p.sourceNodeCount} nodes, v1 shape)`,
            `  Current canvas:       schemaVersion=${p.currentSchemaVersion}`,
            `  Will back up to:      ${p.canvasBackup}`,
            p.nodesArchive
              ? `  Will archive nodes/:  ${p.nodesArchive}  (${p.nodesArchivedFileCount} files)`
              : `  Will archive nodes/:  — (no nodes/ directory)`,
            `  Sentinel cleanup:     .migrating will be removed if present`,
            ``,
            `Re-run without --dry-run to apply.`,
          ].join('\n');
        });
        return;
      }

      if (!cmdOpts.yes) {
        const human = [
          `About to restore workspace "${plan.workspaceId}" from:`,
          `  ${plan.sourcePath}  (${plan.sourceNodeCount} nodes)`,
          ``,
          `This will:`,
          `  1. Back up current canvas.json → ${plan.canvasBackupPath}`,
          plan.nodesArchivePath
            ? `  2. Rename nodes/ → ${plan.nodesArchivePath}  (${plan.nodesArchiveFileCount} files)`
            : `  2. (no nodes/ directory to archive)`,
          `  3. Overwrite canvas.json with the source bytes`,
          ``,
          `Proceed?`,
        ].join('\n');
        const ok = await confirmPrompt(human);
        if (!ok) {
          errorOutput('Aborted.');
        }
      }

      await applyRestorePlan(plan);

      output({ ...planSummary, applied: true }, format, (data) => {
        const p = data as typeof planSummary & { applied: boolean };
        return [
          `✓ Restored "${p.workspaceId}".`,
          `  Backup:        ${p.canvasBackup}`,
          p.nodesArchive
            ? `  nodes/ archive: ${p.nodesArchive}  (delete after verifying with: rm -rf "${p.nodesArchive}")`
            : `  nodes/:        (was empty / absent)`,
          ``,
          `Next: open the workspace in canvas-workspace. Lazy migration`,
          `will rebuild nodes/ from the restored canvas.json.`,
        ].join('\n');
      });
    });
}
