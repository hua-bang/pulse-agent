import type { Command } from 'commander';
import {
  resolveWorkspaceId,
  WorkspaceResolutionError,
  type WorkspaceResolutionSource,
} from '../core/workspace-resolution';
import { errorOutput, type OutputFormat } from '../output';

export interface RootOptions {
  format: OutputFormat;
  storeDir?: string;
  /** The `--workspace` flag value, if explicitly passed (undefined otherwise). */
  workspace?: string;
  /** `--confine-to-workspace`: block file-node paths outside the workspace dir. */
  confineToWorkspace: boolean;
}

/**
 * Walk up to the root `program` and read its global options. Subcommands live
 * one or two levels below the root (`program → node → list`), so we climb to
 * the top rather than guessing the depth.
 */
export function getRootOptions(cmd: Command): RootOptions {
  let root: Command = cmd;
  while (root.parent) root = root.parent;
  const opts = root.opts();
  return {
    format: opts.format ?? 'text',
    storeDir: opts.storeDir,
    workspace: opts.workspace,
    confineToWorkspace: opts.confineToWorkspace === true,
  };
}

export interface WorkspaceCommandOptions extends RootOptions {
  workspace: string;
  workspaceSource: WorkspaceResolutionSource;
}

export interface WorkspaceCommandOptionsConfig {
  /**
   * Require the resolved workspace to have a readable local `canvas.json`.
   * Default `true` — correct for commands that read/write the on-disk store
   * (node, edge, context). Runtime-mediated commands (agent, team) pass
   * `false`: the workspace lives in the running app, and the loopback runtime
   * server is the authority on whether it exists.
   */
  requireReadableCanvas?: boolean;
}

/**
 * Resolve the global options plus the workspace a command should act on,
 * applying the shared discovery order (`--workspace` → env → active
 * workspace). Exits with a friendly error if no workspace can be resolved or
 * the resolved one is invalid, so command actions can treat the returned
 * `workspace` as guaranteed-present.
 */
export async function getWorkspaceCommandOptions(
  cmd: Command,
  config: WorkspaceCommandOptionsConfig = {},
): Promise<WorkspaceCommandOptions> {
  const root = getRootOptions(cmd);
  try {
    const resolution = await resolveWorkspaceId({
      explicitId: root.workspace,
      storeDir: root.storeDir,
      requireReadableCanvas: config.requireReadableCanvas,
    });
    return {
      ...root,
      workspace: resolution.workspaceId,
      workspaceSource: resolution.source,
    };
  } catch (err) {
    const code = err instanceof WorkspaceResolutionError ? err.code : 'error';
    errorOutput((err as Error).message, { code });
  }
}
