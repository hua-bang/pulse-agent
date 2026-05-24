import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SKILL_NAME = 'pulse-canvas';
const LEGACY_SKILL_NAMES = ['canvas'];

const SKILL_PARENT_DIRS = [
  join(homedir(), '.pulse-coder', 'skills'),
  join(homedir(), '.claude', 'skills'),
  join(homedir(), '.codex', 'skills'),
];

const GLOBAL_SKILL_DIRS = SKILL_PARENT_DIRS.map((dir) => join(dir, SKILL_NAME));

const LEGACY_SKILL_DIRS = SKILL_PARENT_DIRS.flatMap((dir) =>
  LEGACY_SKILL_NAMES.map((name) => join(dir, name)),
);

const SKILL_CONTENT = `---
name: pulse-canvas
description: Operate Pulse Canvas workspaces — read user-curated context, write results, create nodes
version: 1.0.0
---

# Pulse Canvas

Interact with canvas workspaces via the \`pulse-canvas\` CLI. The canvas is a shared workspace between humans and agents.

The current workspace ID is available via \`$PULSE_CANVAS_WORKSPACE_ID\` environment variable (auto-set by canvas). All \`node\` and \`context\` commands use it automatically — no need to pass workspace ID explicitly.

## Core Commands

### Read workspace context (start here)
\`\`\`bash
pulse-canvas context --format json
\`\`\`
Returns all nodes with structured info: file paths, frame groups, labels.

### List nodes
\`\`\`bash
pulse-canvas node list --format json
\`\`\`

### Read a node
\`\`\`bash
pulse-canvas node read <nodeId> --format json
\`\`\`

### Write to a node
\`\`\`bash
pulse-canvas node write <nodeId> --content "..."
\`\`\`

### Create a node
\`\`\`bash
pulse-canvas node create --type file --title "Report" --data '{"content":"..."}'
\`\`\`

### Create an edge (connection between nodes)
\`\`\`bash
pulse-canvas edge create --from <nodeId> --to <nodeId> --label "depends on" --kind dependency --format json
\`\`\`

### List edges
\`\`\`bash
pulse-canvas edge list --format json
\`\`\`

### Delete an edge
\`\`\`bash
pulse-canvas edge delete <edgeId> --format json
\`\`\`

### List workspaces
\`\`\`bash
pulse-canvas workspace list --format json
\`\`\`

## Usage Principles
- Before starting a task, run \`context\` to understand the user's canvas layout and intent
- Files on the canvas = files the user considers important — prioritize them
- Frame groups = file associations — understand files in the same group together
- Edges = relationships — understand how frames and nodes connect to each other
- After completing work, write results back to the canvas for the user to review
`;

export interface SkillTargetResult {
  path: string;
  ok: boolean;
  error?: string;
}

async function installSingleTarget(dir: string): Promise<SkillTargetResult> {
  const targetPath = join(dir, 'SKILL.md');
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(targetPath, SKILL_CONTENT, 'utf-8');
    return { path: targetPath, ok: true };
  } catch (err) {
    return { path: targetPath, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkSingleTarget(dir: string): Promise<SkillTargetResult> {
  const targetPath = join(dir, 'SKILL.md');
  try {
    await fs.access(targetPath);
    return { path: targetPath, ok: true };
  } catch {
    return { path: targetPath, ok: false };
  }
}

async function checkLegacyDir(dir: string): Promise<{ dir: string; exists: boolean }> {
  try {
    await fs.access(dir);
    return { dir, exists: true };
  } catch {
    return { dir, exists: false };
  }
}

async function removeLegacyDir(dir: string): Promise<SkillTargetResult> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
    return { path: dir, ok: true };
  } catch (err) {
    return { path: dir, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function setupSkillInstallerIpc(): void {
  ipcMain.handle('skills:install', async () => {
    const results = await Promise.all(GLOBAL_SKILL_DIRS.map(installSingleTarget));
    const ok = results.every((r) => r.ok);
    return {
      ok,
      skillsInstalled: ok,
      results,
      cliInstalled: false,
      manualCommand:
        'cd <project-root> && pnpm --filter @pulse-coder/canvas-cli build && pnpm link --global --filter @pulse-coder/canvas-cli',
      cliError: null,
    };
  });

  ipcMain.handle('skills:status', async () => {
    const [results, legacy] = await Promise.all([
      Promise.all(GLOBAL_SKILL_DIRS.map(checkSingleTarget)),
      Promise.all(LEGACY_SKILL_DIRS.map(checkLegacyDir)),
    ]);
    return {
      installed: results.every((r) => r.ok),
      results,
      legacyDirs: legacy.filter((l) => l.exists).map((l) => l.dir),
    };
  });

  ipcMain.handle('skills:cleanup-legacy', async () => {
    const present = (
      await Promise.all(LEGACY_SKILL_DIRS.map(checkLegacyDir))
    )
      .filter((l) => l.exists)
      .map((l) => l.dir);
    const results = await Promise.all(present.map(removeLegacyDir));
    return {
      ok: results.every((r) => r.ok),
      results,
    };
  });
}
