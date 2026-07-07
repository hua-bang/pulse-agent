import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GrepTool } from './grep';

describe('GrepTool', () => {
  const dirs: string[] = [];
  const makeDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'grep-test-'));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('finds matches and reports file paths', async () => {
    const dir = makeDir();
    writeFileSync(join(dir, 'a.txt'), 'hello world\nfoo bar\n');
    const res = await GrepTool.execute({ pattern: 'foo', path: dir });
    expect(res.output).toContain('a.txt');
    expect(res.matches).toBe(1);
  });

  it('returns "(no matches found)" on rg exit code 1', async () => {
    const dir = makeDir();
    writeFileSync(join(dir, 'a.txt'), 'hello\n');
    const res = await GrepTool.execute({ pattern: 'nomatch_xyz', path: dir });
    expect(res.output).toBe('(no matches found)');
    expect(res.matches).toBe(0);
  });

  it('does NOT execute shell metacharacters in the pattern (injection regression)', async () => {
    const dir = makeDir();
    writeFileSync(join(dir, 'a.txt'), 'safe content\n');
    const marker = join(dir, 'pwned');
    // With the old execSync string build, this pattern would run `touch` via the shell.
    const res = await GrepTool.execute({ pattern: `x;touch ${marker}`, path: dir });
    expect(existsSync(marker)).toBe(false);
    // The literal pattern simply does not match, so no crash and no injection.
    expect(res.output).toBe('(no matches found)');
  });

  it('applies offset and headLimit in-process', async () => {
    const dir = makeDir();
    writeFileSync(join(dir, 'a.txt'), 'l1 m\nl2 m\nl3 m\nl4 m\n');
    const res = await GrepTool.execute({
      pattern: 'm',
      path: dir,
      outputMode: 'content',
      offset: 1,
      headLimit: 2,
    });
    const lines = res.output.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(res.output).toContain('l2 m');
    expect(res.output).toContain('l3 m');
    expect(res.output).not.toContain('l1 m');
    expect(res.output).not.toContain('l4 m');
  });
});
