import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Command } from 'commander';
import { output, type OutputFormat } from '../output';

/** All global skill directories that various agents scan. */
const GLOBAL_SKILL_DIRS = [
  join(homedir(), '.pulse-coder', 'skills'),
  join(homedir(), '.claude', 'skills'),
  join(homedir(), '.codex', 'skills'),
];

interface SkillEntry {
  name: string;
  subdir: string;
  targetSubdir?: string;
  installName?: string;
}

const SKILLS: SkillEntry[] = [
  { name: 'pulse-canvas', subdir: 'canvas', targetSubdir: 'pulse-canvas', installName: 'pulse-canvas' },
  { name: 'canvas-deep-research', subdir: 'canvas-deep-research' },
  { name: 'canvas-frame-research', subdir: 'canvas-frame-research' },
  { name: 'canvas-bootstrap', subdir: 'canvas-bootstrap' },
];

function rewriteSkillName(content: string, name: string): string {
  return content.replace(/^name:.*$/m, `name: ${name}`);
}

async function readSkillContent(skill: SkillEntry): Promise<string | null> {
  const candidates = [
    join(__dirname, '..', 'skills', skill.subdir, 'SKILL.md'),
    join(__dirname, '..', '..', 'skills', skill.subdir, 'SKILL.md'),
  ];
  for (const skillSource of candidates) {
    try {
      const content = await fs.readFile(skillSource, 'utf-8');
      return skill.installName ? rewriteSkillName(content, skill.installName) : content;
    } catch {
      // Try the next packaged/source-tree location.
    }
  }
  if (skill.name === 'pulse-canvas') return getInlineCanvasSkillContent();
  return null;
}

export async function installSkills(targetBaseDir?: string): Promise<{ ok: boolean; paths: string[]; error?: string }> {
  const baseDirs = targetBaseDir ? [targetBaseDir] : GLOBAL_SKILL_DIRS;
  const installed: string[] = [];

  try {
    for (const baseDir of baseDirs) {
      for (const skill of SKILLS) {
        const content = await readSkillContent(skill);
        if (!content) continue;

        const dir = join(baseDir, skill.targetSubdir ?? skill.subdir);
        await fs.mkdir(dir, { recursive: true });
        const targetPath = join(dir, 'SKILL.md');
        await fs.writeFile(targetPath, content, 'utf-8');
        installed.push(targetPath);
      }
    }
    return { ok: true, paths: installed };
  } catch (err) {
    return { ok: false, paths: installed, error: String(err) };
  }
}

function getInlineCanvasSkillContent(): string {
  return `---
name: pulse-canvas
description: Operate Pulse Canvas workspaces — read user-curated context, write results, create nodes
version: 1.0.0
---

# Pulse Canvas

Interact with canvas workspaces via the \`pulse-canvas\` CLI. The canvas is a shared workspace between humans and agents.

Commands resolve the target workspace automatically, so you rarely pass \`--workspace\`. Resolution order: \`--workspace <id>\` → \`$PULSE_CANVAS_WORKSPACE_ID\` (auto-set by canvas) → the app's active workspace. Run \`pulse-canvas workspace current\` to see which one commands will act on, and \`pulse-canvas workspace list\` to see all workspaces (the active one is flagged).

Whenever \`$PULSE_CANVAS_WORKSPACE_ID\` is set, treat the canvas as required user-provided context. Before planning, coding, reviewing, or answering a workspace task, run \`pulse-canvas context --format json\` and use that result alongside repository files.

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

### List workspaces
\`\`\`bash
pulse-canvas workspace list --format json
\`\`\`

## Usage Principles
- Before starting a task, run \`pulse-canvas context --format json\` to understand the user's canvas layout and intent
- Files on the canvas = files the user considers important — prioritize them
- Frame groups = file associations — understand files in the same group together
- After completing work, write results back to the canvas for the user to review
`;
}

export function registerInstallSkillsCommand(program: Command): void {
  program
    .command('install-skills')
    .option('--dir <path>', 'Custom target directory for skills')
    .description('Install canvas skills for agent discovery')
    .action(async function (this: Command, cmdOpts: { dir?: string }) {
      const root = this.parent;
      const format: OutputFormat = root?.opts()?.format ?? 'text';

      const result = await installSkills(cmdOpts.dir);
      if (!result.ok) {
        console.error(`Failed to install skills: ${result.error}`);
        process.exit(1);
      }

      output({ installed: result.paths }, format, (data) => {
        const paths = (data as { installed: string[] }).installed;
        return `Skills installed (${paths.length}):\n${paths.map(p => `  ${p}`).join('\n')}`;
      });
    });
}
