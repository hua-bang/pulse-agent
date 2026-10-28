import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Sandbox `os.homedir()` before `config-scope.ts` evaluates its store paths.
const { sandboxHome } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}canvas-skill-audience-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

import { isCanvasAgentSkill } from '../skills/audience';
import { listCanvasSkills } from '../skills/config';
import { loadDefaultSkills } from '../skills/default-skills';
import { createCanvasAgentToolPolicy } from '../tool-policy';

const CLI_SKILLS_DIR = join(process.cwd(), '../../packages/canvas-cli/skills');

// Native tool names a default skill may reference: the workspace and global
// tool tables plus the engine's `skill` tool.
function nativeToolNames(): Set<string> {
  const names = new Set<string>(['skill']);
  for (const scope of [{ kind: 'workspace', workspaceId: 'ws-test' }, { kind: 'global' }] as const) {
    const policy = createCanvasAgentToolPolicy(scope);
    for (const name of Object.keys({ ...policy.builtInTools, ...policy.canvasTools })) names.add(name);
  }
  return names;
}

const TOOL_REF_RE = /`((?:canvas|workspace|knowledge|memory|session|skill|artifact|visual|dock|image|tavily)_[a-z_]+)/g;

function cliSkillFiles(): Array<{ name: string; content: string }> {
  return readdirSync(CLI_SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      content: readFileSync(join(CLI_SKILLS_DIR, entry.name, 'SKILL.md'), 'utf8'),
    }));
}

beforeEach(async () => {
  await fs.mkdir(join(sandboxHome, '.pulse-coder', 'canvas'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(sandboxHome, { recursive: true, force: true });
});

describe('Canvas Agent skill audience', () => {
  it('reads canvas-agent: false from parsed front matter as a string or a boolean', () => {
    expect(isCanvasAgentSkill(undefined)).toBe(true);
    expect(isCanvasAgentSkill({ 'canvas-agent': true })).toBe(true);
    expect(isCanvasAgentSkill({ 'canvas-agent': false })).toBe(false);
    expect(isCanvasAgentSkill({ 'canvas-agent': 'false' })).toBe(false);
  });

  it('hides external-only skills from the settings list without shadowing same-name skills', async () => {
    const external = join(sandboxHome, '.pulse-coder', 'skills', 'pulse-canvas');
    const lowerPriority = join(sandboxHome, '.claude', 'skills', 'pulse-canvas');
    await fs.mkdir(external, { recursive: true });
    await fs.mkdir(lowerPriority, { recursive: true });
    await fs.writeFile(
      join(external, 'SKILL.md'),
      '---\nname: pulse-canvas\ndescription: CLI copy\ncanvas-agent: false\n---\nRun pulse-canvas node create',
      'utf8',
    );
    await fs.writeFile(
      join(lowerPriority, 'SKILL.md'),
      '---\nname: pulse-canvas\ndescription: Portable copy\n---\nportable',
      'utf8',
    );

    const skills = await listCanvasSkills({ level: 'global' });
    const match = skills.filter(skill => skill.name === 'pulse-canvas');

    expect(match).toHaveLength(1);
    expect(match[0].description).toBe('Portable copy');
  });

  it('keeps default skills on native tools that exist, never the pulse-canvas CLI', async () => {
    const known = nativeToolNames();
    for (const skill of await loadDefaultSkills()) {
      const refs = Array.from(skill.body.matchAll(TOOL_REF_RE), match => match[1]);
      const unknown = refs.filter(ref => !known.has(ref));
      expect({ skill: skill.slug, unknown }).toEqual({ skill: skill.slug, unknown: [] });
      expect(skill.body).not.toMatch(/`pulse-canvas (?:node|edge|apply|layout|workspace)/);
    }
  });

  it('marks every bundled CLI skill that mutates the canvas as external-only', () => {
    for (const { name, content } of cliSkillFiles()) {
      const mutatesViaCli = /pulse-canvas (?:node create|apply|edge create|layout frame-grid)/.test(content);
      const externalOnly = /^canvas-agent:\s*false\s*$/m.test(content);
      if (mutatesViaCli) expect({ name, externalOnly }).toEqual({ name, externalOnly: true });
      if (externalOnly) {
        // External agents have no native Canvas tools; name only CLI commands.
        expect({ name, refs: content.match(/`canvas_(?!candidates)[a-z_]+/g) ?? [] })
          .toEqual({ name, refs: [] });
      }
    }
  });

  it('gives every external-only CLI workflow a native default with the same name', async () => {
    const defaults = new Set((await loadDefaultSkills()).map(skill => skill.name));
    const externalWorkflows = cliSkillFiles()
      .filter(({ content }) => /^canvas-agent:\s*false\s*$/m.test(content))
      .map(({ content }) => /^name:\s*(.+)$/m.exec(content)?.[1].trim())
      .filter((name): name is string => Boolean(name) && name !== 'canvas');

    expect(externalWorkflows.sort()).toEqual(['canvas-bootstrap', 'canvas-frame-research']);
    for (const name of externalWorkflows) expect(defaults.has(name)).toBe(true);
  });
});
