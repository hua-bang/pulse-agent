import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

const { sandboxHome } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}canvas-multi-source-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

import { listCanvasSkills } from '../skills/config';

const GLOBAL = { level: 'global' as const };

const skillMd = (name: string, description: string, body = 'body') =>
  [
    '---',
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    body,
    '',
  ].join('\n');

async function writeSkill(rel: string, name: string, description: string): Promise<void> {
  const path = join(sandboxHome, rel, 'SKILL.md');
  await fs.mkdir(join(sandboxHome, rel), { recursive: true });
  await fs.writeFile(path, skillMd(name, description), 'utf8');
}

beforeEach(async () => {
  await fs.mkdir(sandboxHome, { recursive: true });
});

afterEach(async () => {
  await fs.rm(sandboxHome, { recursive: true, force: true });
});

describe('listCanvasSkills — multi-source aggregation (global scope)', () => {
  it('picks up skills from ~/.claude/skills and ~/.codex/skills', async () => {
    await writeSkill('.claude/skills/code-review', 'code-review', 'When reviewing code');
    await writeSkill('.codex/skills/login-trace', 'login-trace', 'When debugging login');

    const skills = await listCanvasSkills(GLOBAL);
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]));
    expect(Object.keys(byName).sort()).toEqual(['code-review', 'login-trace']);
    expect(byName['code-review']).toMatchObject({ source: 'claude', writable: false });
    expect(byName['login-trace']).toMatchObject({ source: 'codex', writable: false });
  });

  it('tags canvas-managed skills as writable and external ones as read-only', async () => {
    await writeSkill('.pulse-coder/canvas/skills/mine', 'mine', 'mine');
    await writeSkill('.claude/skills/theirs', 'theirs', 'theirs');

    const skills = await listCanvasSkills(GLOBAL);
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]));
    expect(byName.mine).toMatchObject({ source: 'canvas', writable: true });
    expect(byName.theirs).toMatchObject({ source: 'claude', writable: false });
  });

  it('canvas-managed beats external on name collision (first-wins, canvas first)', async () => {
    // Same skill name in both canvas dir and ~/.claude/skills — canvas wins.
    await writeSkill('.pulse-coder/canvas/skills/foo', 'foo', 'canvas version');
    await writeSkill('.claude/skills/foo', 'foo', 'claude version');

    const skills = await listCanvasSkills(GLOBAL);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: 'foo',
      description: 'canvas version',
      source: 'canvas',
    });
  });

  it('case-insensitive name dedupe across sources', async () => {
    await writeSkill('.pulse-coder/canvas/skills/foo', 'Foo', 'canvas');
    await writeSkill('.claude/skills/bar', 'FOO', 'claude'); // same name, different case

    const skills = await listCanvasSkills(GLOBAL);
    expect(skills).toHaveLength(1);
    expect(skills[0].source).toBe('canvas');
  });

  it('walks recursively (nested SKILL.md under ~/.claude/skills/<group>/<sub>)', async () => {
    await writeSkill('.claude/skills/figma/figma-use', 'figma-use', 'When using Figma');

    const skills = await listCanvasSkills(GLOBAL);
    expect(skills.map((s) => s.name)).toEqual(['figma-use']);
    expect(skills[0]).toMatchObject({ source: 'claude', writable: false });
  });

  it('silently skips missing source dirs (typical user has only some installed)', async () => {
    // No source dirs created at all.
    const skills = await listCanvasSkills(GLOBAL);
    expect(skills).toEqual([]);
  });

  it('workspace scope still only sees canvas-managed workspace skills', async () => {
    await writeSkill('.pulse-coder/canvas/ws-x/skills/local', 'local', 'workspace');
    await writeSkill('.claude/skills/global-thing', 'global-thing', 'global');

    const wsSkills = await listCanvasSkills({ level: 'workspace', workspaceId: 'ws-x' });
    expect(wsSkills.map((s) => s.name)).toEqual(['local']);
    expect(wsSkills[0]).toMatchObject({ source: 'canvas', writable: true });
  });
});
