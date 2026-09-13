import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import {
  BuiltInSkillRegistry,
  explicitlyNamedSkillsForContext,
  generateSkillTool,
} from './index';

describe('skills plugin invocation control', () => {
  it('parses explicit-only metadata, hides it from matching, and enforces current-turn exact naming', async () => {
    const root = await mkdtemp(join(tmpdir(), 'explicit-skill-'));
    const automaticDir = join(root, 'automatic');
    const explicitDir = join(root, 'explicit');
    try {
      await mkdir(automaticDir, { recursive: true });
      await mkdir(explicitDir, { recursive: true });
      await writeFile(
        join(automaticDir, 'SKILL.md'),
        '---\nname: automatic-skill\ndescription: Automatically matched skill\n---\nautomatic content',
        'utf8',
      );
      await writeFile(
        join(explicitDir, 'SKILL.md'),
        '---\nname: explicit-skill\ndescription: Human-facing explicit skill summary\ndisable-model-invocation: true\n---\nexplicit content',
        'utf8',
      );
      const registry = new BuiltInSkillRegistry({
        scanPaths: [{ base: root, pattern: '**/SKILL.md' }],
      });
      await registry.initialize(root);

      expect(registry.get('explicit-skill')?.metadata?.['disable-model-invocation']).toBe(true);

      const hiddenTool = generateSkillTool(registry);
      expect(hiddenTool.description).toContain('<name>automatic-skill</name>');
      expect(hiddenTool.description).not.toContain('<name>explicit-skill</name>');
      expect(hiddenTool.description).not.toContain('Human-facing explicit skill summary');
      await expect(hiddenTool.execute({ name: 'explicit-skill' }))
        .rejects.toThrow('requires explicit user invocation by exact name');

      for (const text of [
        'please run explicit',
        'please run explicit-skill-extra',
        'please run Explicit-Skill',
      ]) {
        const names = explicitlyNamedSkillsForContext(
          { messages: [{ role: 'user', content: text }] },
          registry.getAll(),
        );
        expect(names.size).toBe(0);
      }

      const staleNames = explicitlyNamedSkillsForContext(
        {
          messages: [
            { role: 'user', content: 'old mention: explicit-skill' },
            { role: 'assistant', content: 'not loaded' },
            { role: 'user', content: 'continue without a skill' },
          ],
        },
        registry.getAll(),
      );
      expect(staleNames.size).toBe(0);

      const names = explicitlyNamedSkillsForContext(
        {
          messages: [
            { role: 'user', content: 'old mention: explicit-skill' },
            { role: 'assistant', content: 'not loaded' },
            { role: 'user', content: [{ type: 'text', text: 'use /explicit-skill now' }] },
          ],
        },
        registry.getAll(),
      );
      expect(names).toEqual(new Set(['explicit-skill']));
      await expect(generateSkillTool(registry, names).execute({ name: 'explicit-skill' }))
        .resolves.toMatchObject({ name: 'explicit-skill', content: 'explicit content' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
