import { describe, expect, it } from 'vitest';
import { formatSkillContextBlock } from './skill-context';

describe('formatSkillContextBlock', () => {
  it('adds nothing without open skills', () => {
    expect(formatSkillContextBlock()).toBe('');
    expect(formatSkillContextBlock([])).toBe('');
  });

  it('names each open skill with its scope and SKILL.md path', () => {
    const block = formatSkillContextBlock([
      { name: 'Weekly\nreport', scope: 'workspace', path: '/skills/weekly-report/SKILL.md' },
    ]);

    expect(block).toContain('## Skills In Context');
    expect(block).toContain('- **Weekly report** (workspace, `/skills/weekly-report/SKILL.md`)');
  });
});
