import { readFileSync } from 'fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { BuiltInSkillRegistry } from './skills-plugin';

const source = (name: string) => readFileSync(
  join(process.cwd(), 'src', 'built-in', name, 'index.ts'),
  'utf-8',
);

describe('built-in startup scanning', () => {
  it.each(['skills-plugin', 'role-soul-plugin'])(
    '%s avoids synchronous filesystem and glob APIs',
    (name) => {
      expect(source(name)).not.toMatch(/\b[A-Za-z]+Sync\b/);
    },
  );

  it('preserves skill priority, dedupe, error continuation, and rescan behavior', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engine-async-skills-'));
    const high = join(root, 'high');
    const low = join(root, 'low');
    const highSkill = join(high, 'primary', 'SKILL.md');
    try {
      await mkdir(join(high, 'primary'), { recursive: true });
      await mkdir(join(high, 'broken'), { recursive: true });
      await mkdir(join(low, 'duplicate'), { recursive: true });
      await mkdir(join(low, 'alias'), { recursive: true });
      await mkdir(join(low, 'later'), { recursive: true });
      await writeFile(highSkill, '---\nname: Demo\ndescription: high priority\n---\nfirst', 'utf-8');
      await writeFile(join(high, 'broken', 'SKILL.md'), '---\nname: Broken\n---\ninvalid', 'utf-8');
      await writeFile(join(low, 'duplicate', 'SKILL.md'), '---\nname: demo\ndescription: low priority\n---\nsecond', 'utf-8');
      await writeFile(join(low, 'later', 'SKILL.md'), '---\nname: Later\ndescription: valid later file\n---\nlater', 'utf-8');
      await symlink(highSkill, join(low, 'alias', 'SKILL.md'));
      const registry = new BuiltInSkillRegistry({
        scanPaths: [
          { base: high, pattern: '**/SKILL.md' },
          { base: low, pattern: '**/SKILL.md' },
        ],
      });

      await registry.initialize(root);

      expect(registry.getAll().map(skill => skill.name).sort()).toEqual(['Demo', 'Later']);
      expect(registry.get('demo')?.description).toBe('high priority');

      await writeFile(highSkill, '---\nname: Demo\ndescription: rescanned\n---\nupdated', 'utf-8');
      await registry.rescan();
      expect(registry.get('Demo')?.description).toBe('rescanned');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
