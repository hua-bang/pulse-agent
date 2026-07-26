import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { findSkillResources } from './resources';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('findSkillResources', () => {
  it('lists nested bundled files while excluding the root SKILL.md', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'canvas-skill-resources-'));
    roots.push(root);
    await fs.mkdir(join(root, 'scripts'), { recursive: true });
    await fs.writeFile(join(root, 'SKILL.md'), '# Skill');
    await fs.writeFile(join(root, 'scripts', 'check.mjs'), 'export {};');
    await fs.writeFile(join(root, 'reference.md'), '# Reference');

    await expect(findSkillResources(join(root, 'SKILL.md'))).resolves.toEqual([
      { name: 'reference.md', path: join(root, 'reference.md') },
      { name: join('scripts', 'check.mjs'), path: join(root, 'scripts', 'check.mjs') },
    ]);
  });
});
