import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

// Sandbox `os.homedir()` to a temp dir BEFORE the modules under test load —
// `config-scope.ts` computes `CANVAS_STORE_DIR` from `homedir()` at module
// eval time. Mirrors the pattern in `tools-graph.test.ts`.
const { sandboxHome } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}canvas-default-skills-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

import { ensureDefaultSkillsSeeded } from '../default-skills';
import { listCanvasSkills } from '../skills/config';

beforeEach(async () => {
  await fs.mkdir(join(sandboxHome, '.pulse-coder', 'canvas'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(join(sandboxHome, '.pulse-coder'), { recursive: true, force: true });
});

describe('ensureDefaultSkillsSeeded', () => {
  it('writes the bundled default skills into the global scope', async () => {
    await ensureDefaultSkillsSeeded();

    const skills = await listCanvasSkills({ level: 'global' });
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]));

    expect(Object.keys(byName).sort()).toEqual(['memory-review', 'promote-skill', 'save-as-skill', 'suggest-tags']);
    expect(byName['memory-review'].body).toMatch(/memory_adopt/);
    expect(byName['memory-review'].body).toMatch(/session_summary/);
    expect(byName['memory-review'].body).toMatch(/候选 skills/);
    expect(byName['memory-review'].body).toMatch(/canvas_save_skill/);
    expect(byName['save-as-skill'].description).toMatch(/save.*conversation|reusable skill/i);
    expect(byName['save-as-skill'].body).toMatch(/canvas_save_skill/);
    expect(byName['promote-skill'].body).toMatch(/canvas_promote_skill/);
    expect(byName['suggest-tags'].body).not.toMatch(/canvas_propose_node_change/);
    expect(byName['suggest-tags'].body).not.toMatch(/canvas_tag_node/);
    expect(byName['suggest-tags'].body).toMatch(/canvas_list_nodes/);
    expect(byName['save-as-skill'].scope).toBe('global');
  });

  it('upgrades the untouched legacy suggest-tags workflow to advisory output', async () => {
    const skillDir = join(
      sandboxHome,
      '.pulse-coder',
      'canvas',
      'skills',
      'suggest-tags',
    );
    await fs.mkdir(skillDir, { recursive: true });
    const legacy = await fs.readFile(
      join(process.cwd(), 'src/main/agent/__tests__/fixtures/legacy-suggest-tags.md'),
      'utf8',
    );
    await fs.writeFile(join(skillDir, 'SKILL.md'), legacy, 'utf8');

    await ensureDefaultSkillsSeeded();

    const upgraded = await fs.readFile(join(skillDir, 'SKILL.md'), 'utf8');
    expect(upgraded).not.toMatch(/canvas_propose_node_change/);
    expect(upgraded).not.toMatch(/canvas_tag_node/);
  });

  it('does not overwrite an existing user-edited SKILL.md', async () => {
    await ensureDefaultSkillsSeeded();

    const seededPath = join(
      sandboxHome,
      '.pulse-coder',
      'canvas',
      'skills',
      'save-as-skill',
      'SKILL.md',
    );
    const customized = [
      '---',
      'name: "save-as-skill"',
      'description: "my custom trigger"',
      '---',
      '',
      'My customized body.',
      '',
    ].join('\n');
    await fs.writeFile(seededPath, customized, 'utf8');

    // Second seed pass — must leave the edited file alone.
    await ensureDefaultSkillsSeeded();
    const after = await fs.readFile(seededPath, 'utf8');
    expect(after).toBe(customized);
  });

  it('re-creates a missing default after deletion (idempotent on a clean slate)', async () => {
    await ensureDefaultSkillsSeeded();
    await fs.rm(join(sandboxHome, '.pulse-coder', 'canvas', 'skills', 'save-as-skill'), {
      recursive: true,
      force: true,
    });

    await ensureDefaultSkillsSeeded();
    const skills = await listCanvasSkills({ level: 'global' });
    expect(skills.some((s) => s.name === 'save-as-skill')).toBe(true);
  });
});
