/**
 * Conversation-time working-directory resolution for externally-driven
 * roles. A role's cwd is a TASK property, not a role property, so by default
 * none is configured and the directory is picked when the role actually
 * speaks:
 *
 *   role.external.cwd    — explicit pin ("engineer resident in repo X");
 *                          missing on disk is a config error, never silently
 *                          replaced with a fallback.
 *   workspace rootFolder — @ the same role from different workspaces and it
 *                          works in each workspace's project.
 *   per-role scratch dir — ~/.pulse-coder/canvas/agent-home/<roleId>,
 *                          auto-created: pure-discussion roles need zero
 *                          folder preparation.
 */

import { promises as fs, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

function scratchBase(): string {
  const envBase = process.env.PULSE_CANVAS_EXTERNAL_AGENT_HOME?.trim();
  return envBase || join(homedir(), '.pulse-coder', 'canvas', 'agent-home');
}

export async function resolveExternalCwd(opts: {
  roleId: string;
  configuredCwd?: string;
  workspaceRootFolder?: string;
}): Promise<string> {
  const configured = opts.configuredCwd?.trim();
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`External role working directory does not exist: ${configured}`);
    }
    return configured;
  }

  const root = opts.workspaceRootFolder?.trim();
  if (root && existsSync(root)) return root;

  const scratch = join(scratchBase(), opts.roleId);
  await fs.mkdir(scratch, { recursive: true });
  return scratch;
}
