import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SKILLS_DIR = join(homedir(), '.pulse-coder', 'skills', 'canvas');

const SKILL_CONTENT = `---
name: canvas
description: Operate Pulse Canvas workspaces — read user-curated context, write results, create nodes
version: 1.0.0
---

# Pulse Canvas

Interact with canvas workspaces via the \`pulse-canvas\` CLI. The canvas is a shared workspace between humans and agents.

## Core Commands

### Read workspace context (start here)
\`\`\`bash
pulse-canvas context <workspaceId> --format json
\`\`\`
Returns all nodes with structured info: file paths, frame groups, labels.

### List workspaces
\`\`\`bash
pulse-canvas workspace list --format json
\`\`\`

### List nodes
\`\`\`bash
pulse-canvas node list <workspaceId> --format json
\`\`\`

### Read a node
\`\`\`bash
pulse-canvas node read <workspaceId> <nodeId> --format json
\`\`\`

### Write to a node
\`\`\`bash
pulse-canvas node write <workspaceId> <nodeId> --content "..."
\`\`\`

### Create a node
\`\`\`bash
pulse-canvas node create <workspaceId> --type file --title "Report" --data '{"content":"..."}'
\`\`\`

## Usage Principles
- Before starting a task, run \`context\` to understand the user's canvas layout and intent
- Files on the canvas = files the user considers important — prioritize them
- Frame groups = file associations — understand files in the same group together
- After completing work, write results back to the canvas for the user to review
`;

async function installSkillFile(): Promise<{ ok: boolean; path: string; error?: string }> {
  try {
    await fs.mkdir(SKILLS_DIR, { recursive: true });
    const targetPath = join(SKILLS_DIR, 'SKILL.md');
    await fs.writeFile(targetPath, SKILL_CONTENT, 'utf-8');
    return { ok: true, path: targetPath };
  } catch (err) {
    return { ok: false, path: SKILLS_DIR, error: String(err) };
  }
}

async function installCli(): Promise<{ ok: boolean; error?: string; command?: string }> {
  const command = 'npm install -g @pulse-coder/canvas-cli';
  try {
    await execFileAsync('npm', ['install', '-g', '@pulse-coder/canvas-cli'], { timeout: 60_000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err), command };
  }
}

export function setupSkillInstallerIpc(): void {
  ipcMain.handle('skills:install', async () => {
    const skillResult = await installSkillFile();
    if (!skillResult.ok) {
      return {
        ok: false,
        skillsInstalled: false,
        cliInstalled: false,
        error: skillResult.error,
        manualCommand: null,
      };
    }

    const cliResult = await installCli();
    return {
      ok: true,
      skillsInstalled: true,
      skillsPath: skillResult.path,
      cliInstalled: cliResult.ok,
      manualCommand: cliResult.ok ? null : cliResult.command,
      cliError: cliResult.ok ? null : cliResult.error,
    };
  });
}
